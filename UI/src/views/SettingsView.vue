<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h1>设置与数据</h1>
        <p>档案、训练与饮食记录默认只存在这台设备的浏览器里；登录是可选的，登录后才会同步到服务端。需要云端模型时，只发送这次操作所需的内容，密钥留在服务端。</p>
      </div>
      <StatusBadge :variant="store.hasProfile ? 'success' : 'neutral'">{{ store.hasProfile ? '已建档' : '未建档' }}</StatusBadge>
    </div>

    <BaseCard class="section animate-slide-in-up">
      <h2>档案</h2>
      <p class="sub">训练与饮食安排按档案生成；专项、周期与比赛目标等信息选填，填写后会纳入计划与负荷展示。</p>
      <div class="row-line">
        <div><strong>档案</strong><small>{{ profileLine }}</small><em v-if="goalLine" class="goal-line">{{ goalLine }}</em></div>
        <RouterLink class="link" to="/onboarding">{{ store.hasProfile ? '修改档案' : '去建档' }} <ArrowRight :size="14" /></RouterLink>
      </div>
    </BaseCard>

    <!-- 账号与同步：未配置后端时保持纯本机；登录后才启用 outbox 补传 -->
    <BaseCard class="section animate-slide-in-up">
      <div class="llm-head">
        <div>
          <h2>账号与同步</h2>
          <p class="sub">
            不登录也能完整使用，数据只在这台设备。登录后本机记录会补传到账号；断网时继续保存在本机，恢复网络后自动补传，重复提交不会多记一条。
          </p>
        </div>
        <StatusBadge :variant="syncBadgeVariant">{{ syncBadge }}</StatusBadge>
      </div>

      <template v-if="!syncState.apiEnabled">
        <p class="fine">
          当前为纯本机模式。账号与同步尚未启用，记录会保存在这台设备的浏览器中。
        </p>
      </template>

      <template v-else-if="!syncState.user">
        <div class="chips" role="group" aria-label="登录或注册">
          <button type="button" class="chip" :class="{ active: authMode === 'login' }" :aria-pressed="authMode === 'login'" @click="authMode = 'login'">登录</button>
          <button type="button" class="chip" :class="{ active: authMode === 'register' }" :aria-pressed="authMode === 'register'" @click="authMode = 'register'">注册</button>
        </div>
        <div class="fields">
          <label class="field">
            <span class="field-label">邮箱或手机号</span>
            <input v-model.trim="authIdentifier" type="text" autocomplete="username" placeholder="you@example.com" />
          </label>
          <label class="field">
            <span class="field-label">密码（至少 8 位）</span>
            <input v-model="authPassword" type="password" autocomplete="current-password" placeholder="至少 8 位" @keydown.enter.prevent="submitAuth" />
          </label>
        </div>
        <p v-if="localRecordCount" class="fine">
          这台设备还有 {{ localRecordCount }} 条未同步记录；登录后会把它们补传到该账号。确认这些数据属于这个账号再登录。
        </p>
        <div class="actions">
          <BaseButton size="sm" :disabled="authBusy" @click="submitAuth">
            {{ authBusy ? '正在连接…' : authMode === 'login' ? '登录并同步' : '注册并同步' }}
          </BaseButton>
          <BaseButton size="sm" variant="secondary" :disabled="authBusy" @click="startDeviceAccount">先用设备账号</BaseButton>
        </div>
        <p v-if="authError" class="error" role="alert">{{ authError }}</p>
        <p class="fine">设备账号不需要邮箱密码，数据只归属这台设备；以后可以再注册正式账号。</p>
      </template>

      <template v-else>
        <div class="sync-account">
          <div><span>当前账号</span><strong>{{ syncState.user.type === 'anonymous' ? '设备账号' : '正式账号' }}</strong></div>
          <div><span>用户 ID</span><code>{{ syncState.user.id.slice(0, 8) }}…</code></div>
          <div><span>待上传</span><strong>{{ syncState.pending }} 条</strong></div>
          <div><span>上次同步</span><strong>{{ syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString('zh-CN') : '尚未同步' }}</strong></div>
        </div>
        <div class="actions">
          <BaseButton size="sm" :disabled="syncing" @click="syncNowUI">{{ syncing ? '同步中…' : '立即同步' }}</BaseButton>
          <BaseButton size="sm" variant="secondary" :disabled="syncing" @click="logoutAccount">退出登录</BaseButton>
        </div>
        <p v-if="syncState.error" class="error" role="alert">{{ syncState.error }}</p>
        <div v-if="syncState.user.type === 'anonymous'" class="bind-account">
          <strong>绑定正式账号</strong>
          <p class="fine">绑定后设备账号会升级为正式账号，服务端已有记录随账号保留，不会复制或丢弃；绑定后也可以用这组邮箱/手机号和密码在其他设备登录。</p>
          <div class="fields">
            <label class="field">
              <span class="field-label">邮箱或手机号</span>
              <input v-model.trim="authIdentifier" type="text" autocomplete="username" placeholder="you@example.com" />
            </label>
            <label class="field">
              <span class="field-label">设置密码（至少 8 位）</span>
              <input v-model="authPassword" type="password" autocomplete="new-password" placeholder="至少 8 位" />
            </label>
          </div>
          <div class="actions">
            <BaseButton size="sm" :disabled="bindBusy" @click="bindAccountUI">{{ bindBusy ? '绑定中…' : '绑定并保留现有数据' }}</BaseButton>
          </div>
          <p v-if="bindError" class="error" role="alert">{{ bindError }}</p>
        </div>
        <div v-if="syncState.conflicts.length" class="sync-conflicts">
          <strong>需要处理的同步冲突</strong>
          <ul>
            <li v-for="item in syncState.conflicts" :key="item.id">
              <div>
                <span>{{ conflictLabel(item.kind) }} · {{ item.message }}</span>
                <template v-if="item.kind === 'plan' && item.latestPlan">
                  <details>
                    <summary>比较本机与服务端 v{{ item.latestPlan.version }}</summary>
                    <p>本机版本保留在当前计划中，采用服务端版本后仍可在历史中核对。</p>
                    <table class="conflict-table">
                      <thead><tr><th>版本</th><th>安排</th></tr></thead>
                      <tbody>
                        <tr><td>本机</td><td>{{ localConflictPlan(item) }}</td></tr>
                        <tr><td>服务端 v{{ item.latestPlan.version }}</td><td>{{ describePlan(item.latestPlan) }}</td></tr>
                      </tbody>
                    </table>
                  </details>
                  <div class="actions">
                    <BaseButton size="sm" variant="secondary" @click="adoptPlan(item)">采用服务端版本</BaseButton>
                    <RouterLink class="link" to="/plan">查看本机计划</RouterLink>
                  </div>
                </template>
              </div>
              <button v-if="!item.latestPlan" type="button" class="text-btn" @click="retryConflict(item)">重试</button>
            </li>
          </ul>
        </div>
      </template>
    </BaseCard>

    <!-- 大模型接入：配置只存本机，密钥不随导出带走 -->
    <BaseCard class="section animate-slide-in-up">
      <div class="llm-head">
        <div>
          <h2>模型接入</h2>
          <p class="sub">留空就用服务端的内置模型；填了自己的接口就用你自己的。计划生成与照片食物识别共用这份配置，识别照片时模型必须支持图片输入。</p>
        </div>
        <StatusBadge :variant="llmReady ? 'success' : 'neutral'">{{ llmBadge }}</StatusBadge>
      </div>

      <p class="llm-default" :class="{ dim: !store.llmDefault.available }">
        <template v-if="store.llmDefault.available">
          服务端默认模型：<b>{{ store.llmDefault.model }}</b>
        </template>
        <template v-else>
          服务端没有配置默认模型{{ hasCustom ? '' : '，需要自己填一个才能生成计划' }}。
        </template>
      </p>
      <p v-if="store.llmDefault.route === 'spa-fallback'" class="llm-default route-warn" role="alert">
        /api/llm/status 返回了 HTML：线上函数入口没有接管 /api/*。
        请确认 esa.jsonc 的 entry 指向 UI/server/llm.js，并在 ESA 重新发布函数；本地请用 npm run dev 或 npm run preview。
      </p>

      <!-- 用哪个模型是偏好，不是清空：切到内置后，下面填的配置原样保留 -->
      <div class="llm-pick" role="group" aria-label="使用哪个模型">
        <button type="button" :class="{ on: !usingBuiltin }" :aria-pressed="!usingBuiltin" @click="setPreference('custom')">
          使用我填的接口
        </button>
        <button
          type="button"
          :class="{ on: usingBuiltin }"
          :aria-pressed="usingBuiltin"
          :disabled="!store.llmDefault.available"
          @click="setPreference('default')"
        >
          使用内置模型
        </button>
        <span v-if="usingBuiltin" class="pick-note">已切到内置；下面填的配置都还在，随时切回来</span>
        <span v-else-if="!hasCustom" class="pick-note warn">还没填接口，会先回退到内置模型</span>
      </div>

      <div class="fields">
        <label class="field">
          <span class="field-label">base_url</span>
          <input v-model="llmForm.baseUrl" type="text" placeholder="https://api.deepseek.com/v1" autocomplete="off" />
        </label>
        <label class="field">
          <span class="field-label">模型名</span>
          <input v-model="llmForm.model" type="text" placeholder="deepseek-chat" autocomplete="off" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">API Key（只存本机，导出时不会带走）</span>
        <input v-model="llmForm.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </label>

      <div class="llm-actions">
        <BaseButton size="sm" @click="saveLlm">保存配置</BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="testingLlm" @click="runTest">
          {{ testingLlm ? '测试中…' : '测试连接' }}
        </BaseButton>
        <span class="llm-msg" :class="{ bad: llmMsgBad }">{{ llmMsg }}</span>
      </div>

      <p class="fine">
        浏览器直连第三方接口会被 CORS 拦掉，所以请求经同源 <code>/api/llm/chat</code> 转发：本地由 Vite 中间件，线上由阿里云 ESA 函数入口（<code>UI/server/llm.js</code>）。
        你自己的密钥只存在这台设备上，只在这次请求里经过同源代理，不写日志、不入库；
        服务端默认模型的密钥只存在于边缘函数环境变量里，不会下发到浏览器。两者都没有时，应用仍然按内置规则生成计划。
      </p>
      <p class="fine">
        拍照识别同样走这条代理，会把这一张照片发给所选模型；不支持图片输入的模型会在识别时报错。
        失败时仍可改用本机识别或手动补录，原图不保存。
      </p>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>隐私</h2>
      <p class="sub">当前实现里，摄像头画面只在本机做姿态推理，不上传、也不落盘。下面的开关记录的是你的偏好。</p>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.cameraEnabled" @change="setPrivacy('cameraEnabled', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>允许使用摄像头跟练</strong><small>关闭后，跟练页只保留"演示回放"来源。</small></span>
      </label>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.showEnergyEstimate" @change="setPrivacy('showEnergyEstimate', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>显示热量粗估</strong><small>默认关闭。开启后按"区间 + 来源"显示，依赖你填的份量与内置参考值（未与权威成分表核对），不作为营养建议。</small></span>
      </label>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.saveFoodPhotoLocally" @change="setPrivacy('saveFoodPhotoLocally', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>保存饮食照片（仅本机）</strong><small>开启后，拍照记录会保存 256px 缩略图，并把原图存到本机 IndexedDB，点缩略图即可查看原图；两者都不会进入 JSON/CSV 导出，但会占用本地磁盘。关闭后新记录只保留识别结果，已有照片不会自动删除。</small></span>
      </label>

      <p class="fine">
        饮食拍照识别：使用上面「模型接入」里的配置（或服务端默认模型）时，拍照前会明确说明这张照片会发送到该服务并征得你的同意；
        没有配置模型时使用本机模型，照片不上传。识别结果和可选的本机照片只在这台设备：开启时缩略图随记录保存，原图存 IndexedDB；关闭时只保留识别结果。
      </p>

      <div class="fields">
        <div class="field">
          <span class="field-label">导出格式</span>
          <div class="chips">
            <button
              v-for="f in formats"
              :key="f.id"
              class="chip"
              :class="{ active: store.privacy.exportFormat === f.id }"
              :aria-pressed="store.privacy.exportFormat === f.id"
              @click="setPrivacy('exportFormat', f.id)"
            >{{ f.label }}</button>
          </div>
        </div>
      </div>
    </BaseCard>

    <!-- 语音播报（F19）：本机 speechSynthesis，零上传；默认关闭避免与读屏双声道 -->
    <BaseCard class="section animate-slide-in-up">
      <h2>语音播报</h2>
      <p class="sub">用设备自带的中文音色播报组数、次数与休息计时，声音只在本机合成，不上传任何内容。默认关闭：开启后可能与读屏软件的提示同时发声，读屏用户建议保持关闭，页面文字提示始终可用。</p>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.speech.enabled" @change="setSpeechEnabled(($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>开启语音节奏播报</strong><small>只播"第 2 组开始""组间剩 5 秒""本组完成"这类节奏与计时，不做动作纠错，也不输出姿势安全结论。</small></span>
      </label>

      <div class="fields speech-fields">
        <div class="field">
          <span class="field-label">音色（本机枚举到的中文音色）</span>
          <select
            :value="store.speech.voiceURI || firstVoiceURI"
            :disabled="!store.speech.enabled || !chineseVoices.length"
            aria-label="选择播报音色"
            @change="onVoiceChange"
          >
            <option v-if="!chineseVoices.length" value="">暂无可用中文音色</option>
            <option v-for="v in chineseVoices" :key="v.voiceURI" :value="v.voiceURI">{{ v.name }}（{{ v.lang }}）</option>
          </select>
        </div>
        <div class="field">
          <span class="field-label">试听</span>
          <BaseButton size="sm" variant="secondary" :disabled="!store.speech.enabled || !chineseVoices.length" @click="previewVoice">播一句试试</BaseButton>
        </div>
      </div>

      <p v-if="speechDegrade" class="fine">{{ speechDegrade }}</p>
      <p v-else class="fine">没有枚举到音色、设备静音或浏览器不支持时，播报会静默跳过，不报错也不显示"已播报"；开关与音色选择保存在本机。</p>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>外观</h2>
      <p class="sub">默认跟随系统。手动选浅色或深色后就固定下来，不再跟着系统变；这个偏好只存在本机。</p>
      <div class="chips" role="group" aria-label="主题">
        <button
          v-for="t in themes"
          :key="t.id"
          class="chip"
          :class="{ active: store.themePref === t.id }"
          :aria-pressed="store.themePref === t.id"
          @click="store.setTheme(t.id)"
        >{{ t.label }}</button>
      </div>
      <p v-if="store.themePref === 'system'" class="fine">系统当前是{{ systemDark ? '深色' : '浅色' }}，页面已跟着切换。</p>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>计划页完成样式</h2>
      <p class="sub">在计划页点「标记完成」后，整行动作可以持续高亮，或加一条删除线。偏好只存在本机，不改写计划数据。</p>
      <div class="chips" role="group" aria-label="计划页完成样式">
        <button
          v-for="s in completionStyles"
          :key="s.id"
          class="chip"
          :class="{ active: store.planCompletionStyle === s.id }"
          :aria-pressed="store.planCompletionStyle === s.id"
          @click="store.setPlanCompletionStyle(s.id)"
        >{{ s.label }}</button>
      </div>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>我的数据</h2>
      <div class="stats">
        <div class="stat"><span>训练记录</span><b>{{ store.sessions.length }}</b></div>
        <div class="stat"><span>餐食记录</span><b>{{ store.meals.length }}</b></div>
        <div class="stat"><span>缺 RPE 的训练</span><b>{{ rpeMissing }}</b></div>
        <div class="stat"><span>localStorage 占用</span><b>{{ sizeKb }} KB</b></div>
      </div>
      <p class="sub">导出会把档案、训练与餐食按下面的格式写到本机下载目录，不经过任何服务器。JSON 会包含已保存的照片缩略图，但不包含 IndexedDB 里的原图；CSV 不包含图片。登录后也可以让服务端生成导出作业，文件同样可被表格软件打开。</p>
      <div class="actions">
        <BaseButton :icon="Download" @click="exportData(store.privacy.exportFormat)">导出 {{ store.privacy.exportFormat === 'json' ? 'JSON' : 'CSV' }}</BaseButton>
        <BaseButton v-if="syncState.user" variant="secondary" :disabled="remoteExporting" @click="exportRemoteData">{{ remoteExporting ? '服务端生成中…' : '服务端导出 CSV' }}</BaseButton>
      </div>
      <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
      <p v-if="remoteError" class="error" role="alert">{{ remoteError }}</p>
    </BaseCard>

    <BaseCard class="section danger animate-slide-in-up">
      <h2>清除全部数据</h2>
      <p class="sub">删除档案、全部训练与餐食记录，并清空本机存储。此操作不可撤销。登录状态下会先清除服务端数据，再清本机；两步都成功才提示完成。</p>
      <template v-if="!confirming">
        <BaseButton variant="danger" :icon="Trash2" :disabled="!hasData && !syncState.user" @click="confirming = true">清除全部数据</BaseButton>
        <p v-if="!hasData && !syncState.user" class="fine">现在没有任何可清除的记录。</p>
      </template>
      <div v-else class="confirm">
        <p><strong>确认删除 {{ store.sessions.length }} 条训练与 {{ store.meals.length }} 条餐食记录？</strong>{{ syncState.user ? '服务端账号里的同一份数据也会被删除。' : '导出后再清会更稳妥。' }}</p>
        <div class="actions">
          <BaseButton variant="ghost" @click="confirming = false">取消</BaseButton>
          <BaseButton variant="danger" :icon="Trash2" @click="wipe">确认清除</BaseButton>
        </div>
      </div>
      <p v-if="wipeError" class="error" role="alert">{{ wipeError }}</p>

      <div v-if="syncState.user" class="account-danger">
        <h3>删除账号</h3>
        <p class="sub">永久删除正式/设备账号、服务端全部数据与本机缓存。删除后无法用同一账号再登录。</p>
        <template v-if="!deleteConfirming">
          <BaseButton variant="danger" :icon="Trash2" @click="deleteConfirming = true">删除账号</BaseButton>
        </template>
        <div v-else class="confirm">
          <p><strong>确认永久删除这个账号？</strong>服务端数据与本机数据都会删除，不能撤销。</p>
          <div class="actions">
            <BaseButton variant="ghost" @click="deleteConfirming = false">取消</BaseButton>
            <BaseButton variant="danger" :icon="Trash2" :disabled="deletingAccount" @click="deleteAccount">{{ deletingAccount ? '删除中…' : '确认删除账号' }}</BaseButton>
          </div>
        </div>
        <p v-if="accountError" class="error" role="alert">{{ accountError }}</p>
      </div>
    </BaseCard>

    <p class="foot">版本 {{ RULE_VERSION }} · 记录规则与报告口径见记录报告页底部的数据质量说明。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowRight, Download, Trash2 } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import { useSpeech } from '@/composables/useSpeech'
import type { Plan, PlanCompletionStyle, PrivacySettings, ThemePreference } from '@/types/domain'
import { displayName } from '@/utils/time'
import { goalSummary } from '@/services/profileRules'
import { RULE_VERSION } from '@/services/mealRules'
import { canUseLlm, isLlmReady, testLlmConfig, usingDefault } from '@/services/llm'
import type { LlmConfig } from '@/services/llm'
import {
  bindAccount,
  clearConflict,
  deleteRemoteAccount,
  deviceLogin,
  exportRemote,
  login as remoteLogin,
  logout as remoteLogout,
  register as remoteRegister,
  retryConflict,
  syncNow,
  syncState,
  wipeRemote
} from '@/services/sync'
import type { SyncConflict } from '@/services/sync'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const store = useAppStore()
const confirming = ref(false)
const exportError = ref('')
const authMode = ref<'login' | 'register'>('login')
const authIdentifier = ref('')
const authPassword = ref('')
const authBusy = ref(false)
const authError = ref('')
const remoteExporting = ref(false)
const remoteError = ref('')
const wipeError = ref('')
const deletingAccount = ref(false)
const deleteConfirming = ref(false)
const accountError = ref('')
const bindBusy = ref(false)
const bindError = ref('')

const localRecordCount = computed(() => store.sessions.length + store.meals.length + store.plans.length)
const syncing = computed(() => syncState.status === 'syncing')
const syncBadge = computed(() => {
  if (!syncState.apiEnabled) return '仅本机'
  if (!syncState.user) return '未登录'
  if (syncState.status === 'syncing') return '同步中'
  if (syncState.status === 'offline') return '离线待补传'
  if (syncState.status === 'unauthorized') return '需重新登录'
  if (syncState.status === 'error') return '同步出错'
  if (syncState.pending) return `待上传 ${syncState.pending} 条`
  if (syncState.conflicts.length) return '需要处理冲突'
  return '已同步'
})

function describePlan(plan: Plan): string {
  return plan.items.map((item) => `${item.date} ${item.exerciseName} ${item.plannedSets ?? '—'}组 × ${item.plannedReps ?? '—'}次 / ${item.plannedDuration ?? '—'}分钟`).join('；')
}
function localConflictPlan(conflict: SyncConflict): string {
  const local = store.plans.find((plan) => (plan.clientId ?? plan.id) === conflict.clientId)
  return local ? `v${local.version}：${describePlan(local)}` : '见计划历史'
}
function adoptPlan(conflict: SyncConflict) {
  if (!conflict.latestPlan) return
  store.adoptRemotePlan(conflict.clientId, conflict.latestPlan)
  clearConflict(conflict.id)
}
const syncBadgeVariant = computed<BadgeVariant>(() => {
  if (!syncState.apiEnabled || !syncState.user) return 'neutral'
  if (syncState.status === 'unauthorized' || syncState.status === 'error') return 'danger'
  if (syncState.status === 'offline' || syncState.pending || syncState.conflicts.length) return 'warning'
  if (syncState.status === 'syncing') return 'info'
  return 'success'
})

const formats: { id: PrivacySettings['exportFormat']; label: string }[] = [
  { id: 'json', label: 'JSON（完整结构）' },
  { id: 'csv', label: 'CSV（表格软件可开）' }
]
const themes: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' }
]
const completionStyles: { id: PlanCompletionStyle; label: string }[] = [
  { id: 'highlight', label: '整行高亮' },
  { id: 'strike', label: '整行划掉' }
]
// ——— 模型接入 ———
const llmForm = ref<LlmConfig>({ ...store.llmConfig })
const hasCustom = computed(() => isLlmReady(llmForm.value))
const llmReady = computed(() => canUseLlm(llmForm.value, store.llmDefault))
const usingBuiltin = computed(() => usingDefault(llmForm.value))
const llmBadge = computed(() =>
  usingBuiltin.value ? (store.llmDefault.available ? '内置模型' : '未配置') : hasCustom.value ? '自己的接口' : '接口未填'
)
const testingLlm = ref(false)
const llmMsg = ref('')
const llmMsgBad = ref(false)

function saveLlm() {
  // 填完点保存 = 想用自己这份，所以顺手切到自定义偏好（而不是留着"内置"却存了一份不用的配置）
  const ready = isLlmReady(llmForm.value)
  store.setLlmConfig({ ...llmForm.value, preference: ready ? 'custom' : llmForm.value.preference })
  llmForm.value = { ...store.llmConfig }
  llmMsgBad.value = false
  llmMsg.value = ready ? '已保存，并切到这份配置' : '已保存（还没填全，仍会用内置模型）'
  store.showToast({
    type: 'success',
    title: '模型配置已保存',
    message: ready ? '建档完成后会用这份配置生成计划' : '接口没填全，生成时仍回退到服务端默认模型',
    duration: 3000
  })
}

/** 只切偏好：切到内置时不清空任何已填内容 */
function setPreference(preference: 'custom' | 'default') {
  store.setLlmPreference(preference)
  llmForm.value = { ...store.llmConfig }
  llmMsgBad.value = false
  llmMsg.value = preference === 'default'
    ? '已切到内置模型；你填的配置仍然保留'
    : '已切回你自己的接口'
}

async function runTest() {
  store.setLlmConfig({ ...llmForm.value })
  llmForm.value = { ...store.llmConfig }
  testingLlm.value = true
  llmMsgBad.value = false
  llmMsg.value = '正在请求模型…'
  try {
    const res = await testLlmConfig(store.llmConfig)
    llmMsg.value = res.message
    llmMsgBad.value = !res.ok
  } finally {
    testingLlm.value = false
  }
}

const systemDark = ref(typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false)

const profileLine = computed(() => {  const p = store.userProfile
  if (!p) return '还没有档案，可以先建档再看推荐说明。'
  const bits = [displayName(p.nickname), p.goal, p.experience].filter(Boolean)
  // 身体数据只并列展示，不做任何评价
  const body = [p.height ? `${p.height} cm` : '', p.weight ? `${p.weight} kg` : ''].filter(Boolean).join(' / ')
  if (body) bits.push(body)
  return bits.join(' · ')
})
/** 填了比赛或周期目标时多一行目标摘要，说法由 profileRules 统一 */
const goalLine = computed(() => {
  const p = store.userProfile
  if (!p) return ''
  if (!p.targetEvent?.trim() && !p.discipline?.trim() && !p.cyclePhase?.trim()) return ''
  return goalSummary(p)
})
const rpeMissing = computed(() => store.sessions.filter(s => s.rpe === null).length)
const hasData = computed(() => store.sessions.length + store.meals.length + store.plans.length > 0 || store.hasProfile)
const payload = computed(() => ({
  exportedAt: new Date().toISOString(),
  profile: store.userProfile,
  privacy: store.privacy,
  sessions: store.sessions,
  // 原图在本机 IndexedDB，不随 JSON 导出；photoId 在导出文件里也就没有意义
  meals: store.meals.map(m => ({ ...m, photoId: undefined })),
  plans: store.plans,
  planHistory: store.planHistory,
  // 关键帧只在本机 IndexedDB，导出只带结构化结果
  analyses: store.analyses,
  unitGrams: store.unitGrams
}))
const sizeKb = computed(() => Math.max(1, Math.round(new Blob([JSON.stringify(payload.value)]).size / 1024)))

function setPrivacy<K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) {
  store.updatePrivacy({ [key]: value } as Partial<PrivacySettings>)
  store.showToast({ type: 'success', title: '设置已保存', message: '只写在本机 localStorage', duration: 2000 })
}

// ——— 语音播报（F19）———
const { chineseVoices, degradeReason: speechDegrade, preview: speakPreview } = useSpeech()
// 空选择 = 用第一个中文音色（useSpeech.findVoice 的回落语义），下拉框把实际生效的显示出来
const firstVoiceURI = computed(() => chineseVoices.value[0]?.voiceURI ?? '')

function setSpeechEnabled(on: boolean) {
  store.updateSpeech({ enabled: on })
  // 开启的同时给一句试听：用户手势刚发生，浏览器允许发声，立刻能确认效果
  if (on) speakPreview('第 2 组开始')
}

function onVoiceChange(e: Event) {
  store.updateSpeech({ voiceURI: (e.target as HTMLSelectElement).value })
  speakPreview('第 2 组开始')
}

function previewVoice() {
  speakPreview('第 2 组开始，共 10 次')
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toCsv(): string {
  const head = ['类别', '日期', '时间', '名称', '类型或类别', '时长分钟', '距离米', '次数', '组数', '单位', 'RPE', '负荷', '不适', '状态', '备注']
  const rows = [
    ...store.sessions.map(s => [
      '训练', s.date, s.createdAt.slice(11, 16), s.exerciseName, s.type,
      s.actualDuration ?? '', s.actualDistance ?? '', s.actualReps ?? '', s.actualSets ?? '', '',
      s.rpe ?? '未记录', s.rpe === null || !s.actualDuration ? '未计入' : Math.round(s.actualDuration * s.rpe),
      s.discomfort ? '是' : '否', s.completionStatus, s.notes ?? ''
    ]),
    ...store.meals.flatMap(m => m.items.map(i => [
      // 餐食的量写在"次数/数量"列、单位写在"单位"列，其余数值列留空
      '餐食', m.date, m.time, i.foodName, i.category,
      '', '', i.portionSize ?? '', '', i.portionUnit ?? '', '', '', '', m.completeness, i.source === 'photo' ? '照片识别候选，已由用户确认' : ''
    ])),
    ...store.plans.flatMap(p => p.items.map(i => [
      '计划', i.date, '', i.exerciseName, i.type,
      i.plannedDuration ?? '', i.plannedDistance ?? '', i.plannedReps ?? '', i.plannedSets ?? '', '',
      '', '', '', i.completed ? '已完成' : '待完成', `v${p.version}｜${p.reason}`
    ])),
    ...store.analyses.map(a => [
      '分析', a.date, '', a.exerciseName, a.action,
      '', '', '', '', '', '', '', '',
      a.status === 'low-confidence' ? '低置信度' : '完成',
      `视角 ${a.view === 'side' ? '侧面' : '正面'}｜${a.findings.length} 项关注｜${a.ruleVersion}`
    ])
  ]
  return '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}

function download(filename: string, mime: string, text: string) {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败'
}

async function submitAuth() {
  if (authBusy.value) return
  authError.value = ''
  if (!authIdentifier.value || !authPassword.value) {
    authError.value = '请填写邮箱/手机号和密码'
    return
  }
  authBusy.value = true
  try {
    if (authMode.value === 'login') await remoteLogin(authIdentifier.value, authPassword.value)
    else await remoteRegister(authIdentifier.value, authPassword.value)
    authPassword.value = ''
    store.showToast({
      type: 'success',
      title: authMode.value === 'login' ? '已登录' : '账号已创建',
      message: `已拉取服务端数据；${syncState.pending} 条本机变更待补传`,
      duration: 3000
    })
  } catch (error) {
    authError.value = errorMessage(error)
  } finally {
    authBusy.value = false
  }
}

async function startDeviceAccount() {
  if (authBusy.value) return
  authError.value = ''
  authBusy.value = true
  try {
    await deviceLogin()
    store.showToast({ type: 'success', title: '设备账号已启用', message: '数据会归属这台设备，并可同步到服务端', duration: 3000 })
  } catch (error) {
    authError.value = errorMessage(error)
  } finally {
    authBusy.value = false
  }
}

async function syncNowUI() {
  if (syncing.value) return
  await syncNow()
  if (syncState.error) {
    store.showToast({ type: 'warning', title: '同步未完成', message: syncState.error, duration: 4000 })
  } else {
    store.showToast({ type: 'success', title: '已同步', message: syncState.pending ? `仍有 ${syncState.pending} 条待补传` : '本机与服务端已对齐', duration: 2500 })
  }
}

async function bindAccountUI() {
  if (bindBusy.value) return
  bindError.value = ''
  if (!authIdentifier.value || !authPassword.value) {
    bindError.value = '请填写邮箱/手机号和密码'
    return
  }
  bindBusy.value = true
  try {
    await bindAccount(authIdentifier.value, authPassword.value)
    authPassword.value = ''
    store.showToast({ type: 'success', title: '已绑定正式账号', message: '设备账号与现有记录已升级，不会搬家', duration: 3000 })
  } catch (error) {
    bindError.value = errorMessage(error)
  } finally {
    bindBusy.value = false
  }
}

async function logoutAccount() {
  await remoteLogout()
  store.showToast({ type: 'info', title: '已退出账号', message: '本机数据保留，仍可离线使用', duration: 2500 })
}

function conflictLabel(kind: string): string {
  if (kind === 'session') return '训练记录'
  if (kind === 'meal') return '餐食记录'
  if (kind === 'plan') return '计划版本'
  return '档案'
}

async function exportRemoteData() {
  if (remoteExporting.value || !syncState.user) return
  remoteError.value = ''
  remoteExporting.value = true
  try {
    const { blob, filename } = await exportRemote('csv')
    downloadBlob(filename, blob)
    store.showToast({ type: 'success', title: '服务端导出已下载', message: '文件由服务端作业生成，表格软件可直接打开', duration: 2500 })
  } catch (error) {
    remoteError.value = `服务端导出失败：${errorMessage(error)}`
  } finally {
    remoteExporting.value = false
  }
}

async function deleteAccount() {
  if (!syncState.user || deletingAccount.value) return
  accountError.value = ''
  deletingAccount.value = true
  try {
    await deleteRemoteAccount()
    store.clearAllData()
    deleteConfirming.value = false
    store.showToast({ type: 'success', title: '账号已删除', message: '服务端与本机数据都已清除', duration: 3000 })
  } catch (error) {
    accountError.value = errorMessage(error)
  } finally {
    deletingAccount.value = false
  }
}

function exportData(format: PrivacySettings['exportFormat']) {
  exportError.value = ''
  const stamp = new Date().toISOString().slice(0, 10)
  try {
    if (format === 'json') {
      download(`twopoles-${stamp}.json`, 'application/json;charset=utf-8', JSON.stringify(payload.value, null, 2))
    } else {
      download(`twopoles-${stamp}.csv`, 'text/csv;charset=utf-8', toCsv())
    }
    store.showToast({ type: 'success', title: '已开始下载', message: '文件由本机浏览器直接生成', duration: 2500 })
  } catch (err) {
    exportError.value = `导出失败：${(err as Error)?.message || '浏览器阻止了下载'}`
  }
}

async function wipe() {
  wipeError.value = ''
  if (syncState.user) {
    try {
      await wipeRemote()
    } catch (error) {
      wipeError.value = `服务端清除失败：${errorMessage(error)}。本机数据未删除，可重试。`
      return
    }
  }
  store.clearAllData()
  confirming.value = false
  store.showToast({
    type: 'success',
    title: '数据已清除',
    message: syncState.user ? '服务端与本机的档案、训练、餐食与计划都已删除' : '本机的档案、训练、餐食与计划都已删除',
    duration: 3000
  })
}
</script>

<style scoped>
.page-wrap{max-width:860px;margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:28px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0;line-height:1.7}
.section{padding:22px;margin-bottom:14px}
.section h2{font-size:17px;margin-bottom:6px}
.sub{font-size:12px;color:var(--color-text-muted);line-height:1.7;margin:0 0 14px}
.row-line{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-top:14px;border-top:1px solid var(--color-divider)}
.row-line strong{display:block;font-size:13px;color:var(--color-ink)}
.row-line small{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:3px}
.link{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--color-accent);white-space:nowrap}
.toggle{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-divider);cursor:pointer}
.toggle input{position:absolute;opacity:0;width:1px;height:1px}
.tg{width:42px;height:24px;border-radius:999px;background:var(--color-border);flex:none;padding:3px;transition:background var(--motion-base) var(--easing-ease-out)}
.tg i{display:block;width:18px;height:18px;border-radius:50%;background:var(--surface-field);box-shadow:var(--shadow-sm);transition:transform var(--motion-base) var(--easing-spring)}
.toggle input:checked+.tg{background:var(--color-accent)}
.toggle input:checked+.tg i{transform:translateX(18px)}
.toggle input:focus-visible+.tg{outline:2px solid var(--color-accent);outline-offset:2px}
.tlabel strong{display:block;font-size:13px;color:var(--color-ink)}
.tlabel small{display:block;font-size:12px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.fields{display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-top:16px}
.field{display:block}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.field select{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.field select:disabled{opacity:.5;cursor:not-allowed}
.speech-fields{align-items:end}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 14px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip.active{background:var(--color-accent);color:var(--color-on-accent)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.stat{padding:14px;border-radius:14px;background:var(--color-neutral-soft)}
.stat span{display:block;font-size:11px;color:var(--color-text-muted)}
.stat b{display:block;font-size:20px;color:var(--color-ink);margin-top:4px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.actions :deep(button){width:auto;padding:0 20px}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:10px 13px;margin:12px 0 0}
.fine{font-size:11px;color:var(--color-text-muted);margin:8px 0 0;line-height:1.6}
.confirm{padding:16px;border-radius:14px;background:var(--color-danger-soft);border:1px solid var(--color-danger)}
.confirm p{font-size:13px;color:var(--color-danger);margin:0 0 12px;line-height:1.7}
.section.danger h2{color:var(--color-danger)}
.foot{font-size:11px;color:var(--color-text-muted);text-align:center;margin:16px 0 0}
@media(max-width:767px){.fields,.stats{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.page-head{flex-direction:column;align-items:flex-start}.actions :deep(button){width:100%}}
.llm-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.llm-pick button{padding:8px 14px;border-radius:10px;font-size:12.5px;font-weight:600;min-height:38px;color:var(--color-text-secondary);background:var(--color-neutral-soft);border:1px solid transparent}
.llm-pick button.on{background:var(--color-accent);color:var(--color-on-accent)}
.llm-pick button:disabled{opacity:.45;cursor:not-allowed}
.pick-note{font-size:11.5px;color:var(--color-text-muted)}
.pick-note.warn{color:var(--color-caution)}
.llm-default{font-size:12px;color:var(--color-text-secondary);margin:-4px 0 14px;line-height:1.6}
.llm-default b{font-family:var(--font-num);color:var(--color-accent)}
.llm-default.dim{color:var(--color-text-muted)}
.llm-default.route-warn{color:var(--color-caution);background:var(--color-caution-soft);padding:9px 11px;border-radius:var(--radius-sm);margin-top:-6px}
.llm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
.llm-head h2{margin:0}
.llm-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.llm-msg{font-size:12px;color:var(--color-text-muted);line-height:1.6}
.llm-msg.bad{color:var(--color-danger)}
.fine code{font-family:var(--font-mono);font-size:11.5px;background:var(--color-neutral-soft);padding:1px 5px;border-radius:4px}
.sync-account{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}
.sync-account>div{padding:10px 12px;border-radius:var(--radius-sm);background:var(--color-neutral-soft);display:grid;gap:3px}
.sync-account span{font-size:10.5px;color:var(--color-text-muted)}
.sync-account strong,.sync-account code{font-size:12.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sync-conflicts{margin-top:14px;padding:11px 13px;border-radius:var(--radius-sm);background:var(--color-caution-soft);border:1px solid var(--color-caution)}
.sync-conflicts>strong{display:block;font-size:12.5px;color:var(--color-caution);margin-bottom:6px}
.sync-conflicts ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.sync-conflicts li{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--color-text-secondary);line-height:1.5}
.sync-conflicts li>div{min-width:0;overflow-wrap:anywhere}
.conflict-table{width:100%;border-collapse:collapse;margin:8px 0}
.conflict-table th,.conflict-table td{padding:6px;text-align:left;vertical-align:top;border:1px solid var(--color-border);overflow-wrap:anywhere}
.account-danger{margin-top:18px;padding-top:16px;border-top:1px solid var(--color-border)}
.account-danger h3{font-size:14px;color:var(--color-danger);margin:0 0 6px}
@media(max-width:767px){.sync-account{grid-template-columns:1fr 1fr}}
</style>
