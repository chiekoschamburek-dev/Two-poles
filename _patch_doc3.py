from pathlib import Path
T = Path(r'D:\桌面\project\project\artifacts\fitness-design\build_document.py')
src = T.read_text(encoding='utf-8'); miss=[]
def rep(old,new):
    global src
    if old not in src: miss.append('MISS '+old[:46]); return
    if src.count(old)>1: miss.append('AMBIG '+old[:46]); return
    src = src.replace(old,new)
def cut(a,b,repl=''):
    global src
    i,j=src.find(a),src.find(b)
    if i<0: miss.append('CUTNOA '+a[:40]); return
    if j<0 or j<i: miss.append('CUTNOB '+b[:40]); return
    src=src[:i]+repl+src[j+len(b):]

rep("para('项目总体目标是实现可独立演示、可重复验证的双模式个人运动辅助系统。以下指标为计划验收目标，不代表已经完成开发或获得实测结果；截至本文档定稿时的实际实现边界见2.5节。')",
    "para('项目总体目标是实现可独立演示、可重复验证的双模式个人运动辅助系统。以下指标为验收目标。')")

rep("para('服务端使用Python运行环境和SQLite数据库，可部署在Windows或Linux。本机演示使用localhost。校园局域网演示同样可行，但摄像头接口只在安全上下文（HTTPS或localhost）下可用：以局域网IP的http地址访问时浏览器不会授予摄像头权限，此时该设备只能用手工记录与查看，或为局域网地址配置HTTPS后再验收跟练功能。公网部署使用HTTPS。模型和规则资源提前下载并固定版本，初次准备后核心演示不依赖外网。')",
    "para('摄像头计数以电脑端Chrome/Edge为验收环境，需要720p摄像头、单人完整入镜和稳定光照。移动端用Android手机的微信内置浏览器验证基础记录与查看：窄屏下保留今日、记录、图表、我的四项底部导航，记录表单就地展开在触发它的卡片内。摄像头接口只在安全上下文（HTTPS或localhost）下可用，因此手机经局域网http地址访问、或在微信内置浏览器中打开时，跟练一律回落到手工计时与录入，界面同时说明原因。本机演示使用localhost，公网部署使用HTTPS。')\npara('服务端使用Python运行环境和SQLite数据库，可部署在Windows或Linux。模型和规则资源提前下载并固定版本，初次准备后核心演示不依赖外网。')")

rep("('前端','Vue 3、TypeScript、Vite、Pinia','响应式网页；版本在立项时锁定并保留依赖清单'),('后端','Python 3.11、FastAPI','业务接口、输入校验和规则服务'),('视觉','MediaPipe Tasks Vision、Canvas','浏览器端姿态推理；模型和包固定版本及校验值'),('数据','SQLite 3、SQLAlchemy、Alembic','单机部署、结构迁移与事务；保留升级接口')",
    "('前端','Vue 3.4、TypeScript 5.9、Vite 5、Pinia 2.1、vue-tsc 2.2','响应式网页；版本锁定在package.json与package-lock.json'),('图标与图形','lucide-vue-next 0.309、自绘SVG与CSS','不引入第三方图表库；缺数据时图表保持空白而不是补0'),('端侧视觉','@mediapipe/tasks-vision 1.1.1、Canvas、Web Worker','浏览器端姿态推理与关键点绘制；模型与wasm固定版本并本地预置'),('端侧能力','Web Speech API、DeviceMotion/DeviceOrientation、Service Worker加IndexedDB、Notification API','依次用于语音节奏播报、计时与计步型课次、离线安装与本地提醒；按可用性降级，不谎报'),('后端','Python 3.11、FastAPI','业务接口、输入校验和规则服务'),('数据','SQLite 3、SQLAlchemy、Alembic','单机部署、结构迁移与事务；不使用jsonb与enum，多值字段以JSON文本存TEXT并加CHECK约束')")

cut("h('2.5 当前实现状态与验收对应')", "端到端测试、真机摄像头验证与服务端接口测试尚未开展。')\n")

rep("para('（7）验证方法：",
    "para('（5）运动×饮食交叉分析：以日期为键把训练记录与已确认餐次并列，输出训练日与休息日的类别结构差、某类出现的当天与次日完成率、按当日计划强度提示当天仍缺的类别。全部为同机可算的描述性统计，界面一律写“同期出现”而不写“有助于”，不下因果与营养结论。')\npara('（6）端侧能力与降级：语音节奏播报用Web Speech API的speechSynthesis，枚举到中文音色才启用，否则回落到页面文字与aria-live；计时与计步型课次用DeviceMotion或DeviceOrientation采加速度峰值，权限被拒、无传感器或浏览器不支持时退回手动计时；离线安装与本地缓存用Service Worker加IndexedDB，本地提醒用Notification API，未授权或受系统限制时只保留应用内提示。所有降级都在界面上说明原因。')\npara('（7）验证方法：")

rep("para('界面同时呈现动作、组次和计数状态。首次进入展示机位示范和权限说明；未完整入镜或置信度不足时提示暂停计数。用户可手工修正、结束训练和填写反馈；图中骨架为示意绘制，不是实际识别结果。')",
    "para('界面同时呈现动作、组次、次数与阶段状态。首次进入展示机位示范与权限说明；未完整入镜或可见度不足时冻结计数并提示重新入镜。计数由关键点状态机驱动，右侧显示当前阶段与达标提示，用户可暂停、修正、结束并填写反馈；计数来源（实时识别或演示回放）与是否已校机位在界面上明确标注，识别结果永远可改。')")

rep("'完成大众模板、运动员跑步计划、锁定与版本、视觉计数和手工记录。交付两个模式训练演示。'",
    "'完成大众条件化模板、运动员跑步计划、锁定与版本、视觉计数与机位校准、手工记录，以及休息页引导与语音播报。交付两个模式训练演示。'")

rep("para('（3）示例与验证数据：至少20个基础动作条目、40个食物条目（当前前端已内置27条动作与56条食物参考值，来源均为如实标注的演示参考值）、两种模式示例计划、经授权的动作验证片段及标注说明；附数据来源与许可信息。')",
    "para('（3）示例与验证数据：不少于20个基础动作条目与40个食物条目，均带来源、口径与版本标注（未与权威成分表逐项核对的条目须显式标记）；含混合菜清单、两种模式示例计划、经授权的动作验证片段及标注说明；附数据来源与许可信息。')")

T.write_text(src,encoding='utf-8')
print('problems',len(miss))
for m in miss: print('  ',m)
