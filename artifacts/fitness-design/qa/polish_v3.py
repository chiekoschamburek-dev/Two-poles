from pathlib import Path
p=Path('artifacts/fitness-design/build_document.py')
s=p.read_text(encoding='utf-8-sig')
old="   if i<len(rows)-1: arrow(d,(x+w//2,y+115),(750,y+145))"
new="""  if i<len(rows)-1:
   next_w=(1410-(len(rows[i+1])-1)*25)//len(rows[i+1])
   parents=[45+j*(w+25)+w//2 for j in range(len(row))]
   children=[45+j*(next_w+25)+next_w//2 for j in range(len(rows[i+1]))]
   rail=y+130
   for cx in parents: d.line([(cx,y+110),(cx,rail)],fill='#7c91a2',width=4)
   d.line([(min(parents+children),rail),(max(parents+children),rail)],fill='#7c91a2',width=4)
   for cx in children: arrow(d,(cx,rail),(cx,y+150))"""
assert old in s;s=s.replace(old,new)
a=s.index("diagram('architecture'");b=s.index("diagram('flow'",a)
s=s[:a]+"""# Explicit client/server boundary; raw frames never flow into the server.
im=Image.new('RGB',(1500,780),'white'); d=ImageDraw.Draw(im)
text(d,(45,25),'系统总体架构与数据流向',36,b=True)
box(d,(45,90,1455,275),BG); text(d,(65,104),'浏览器客户端',27,TEAL,True)
box(d,(70,153,720,254)); text(d,(90,165),'Vue 界面与本地记录',27,b=True); text(d,(90,211),'双模式首页 · 训练日历 · 餐盘 · 周报',22)
box(d,(865,153,1430,254)); text(d,(885,165),'本地视觉处理',27,b=True); text(d,(885,207),'摄像头 → 关键点 → 动作状态与次数',21); text(d,(885,233),'原始画面默认不上传',18,MUTED)
arrow(d,(865,198),(725,198));text(d,(735,163),'计数摘要',20,MUTED)
arrow(d,(390,255),(390,375));text(d,(75,298),'用户确认后提交摘要 / HTTPS · JSON',23,TEAL)
box(d,(45,351,1060,760),BG); text(d,(660,359),'FastAPI 业务服务端',23,TEAL,True)
box(d,(70,390,1035,470));text(d,(90,410),'统一接口：身份校验 · 归属检查 · 请求去重',27,b=True)
arrow(d,(340,470),(340,520));arrow(d,(810,470),(810,520))
box(d,(70,520,540,611)); text(d,(90,535),'训练与规则服务',27,TEAL,True);text(d,(90,575),'条件过滤 · 计划版本 · 负荷统计',22)
box(d,(565,520,1035,611)); text(d,(585,535),'饮食与报告服务',27,TEAL,True);text(d,(585,575),'结构规则 · 缺失标记 · 周报聚合',22)
arrow(d,(340,611),(340,655));arrow(d,(810,611),(810,655))
box(d,(70,655,1035,740));text(d,(90,668),'SQLite 数据库',27,TEAL,True);text(d,(90,708),'账号 · 计划 · 训练 · 餐次 · 规则版本；事务写入',22)
box(d,(1100,520,1455,740));text(d,(1120,538),'静态资源',28,TEAL,True);lines(d,(1120,587),'固定版本姿态模型\n动作示范与食物目录\n随部署预置，按需加载',22,14,gap=14)
arrow(d,(1280,520),(1280,278));text(d,(1300,365),'本地加载',22,MUTED)
im.save(ASSET/'architecture.png')
"""+s[b:]
s=s.replace("'已记录早餐和午餐\\n晚餐尚未记录，暂不判断全天结构。',24,14)","'早餐、午餐已记录。\\n晚餐待补，全天分析未完成。',23,15,gap=7)")
a=s.index("im,d=ui_base('今日概览  /  跑步专项训练台'");b=s.index("im,d=ui_base('摄像头跟练",a)
s=s[:a]+"""im,d=ui_base('今日概览  /  跑步专项训练台','运动员模式')
for x,val,label in [(270,'基础准备期','当前周期'),(675,'540 AU','近 7 日已记录负荷'),(1080,'3 / 5','本周训练记录')]:
 box(d,(x,225,x+370,355)); text(d,(x+25,244),label,22,MUTED); text(d,(x+25,288),val,35,TEAL,True)
box(d,(270,385,980,720)); text(d,(300,410),'周计划与实际完成',29,b=True)
text(d,(302,456),'时长 / 分钟',20,MUTED)
for tick in [0,30,60]:
 yy=638-tick*2.4;d.line((358,yy,942,yy),fill=LINE,width=2);text(d,(311,yy-13),str(tick),19,MUTED)
planned=[30,45,0,35,25,50,0];actual=[28,40,0,30,None,None,0]
for i,day in enumerate(['一','二','三','四','五','六','日']):
 x=372+i*81;text(d,(x+9,650),day,21,MUTED)
 if planned[i]:d.rounded_rectangle((x,638-planned[i]*2.4,x+24,638),5,fill=TEAL)
 if actual[i]:d.rounded_rectangle((x+29,638-actual[i]*2.4,x+53,638),5,fill='#93b3cd')
 if actual[i] is None:text(d,(x+29,614),'待',18,MUTED)
 if not planned[i]:text(d,(x+8,614),'休',18,MUTED)
text(d,(300,690),'绿色：计划   蓝色：实际   待：未记录   休：休息日',19,MUTED)
box(d,(1010,385,1450,720)); text(d,(1040,410),'今日训练',29,b=True); lines(d,(1040,465),'跑步 · 轻松训练\\n计划 30 分钟\\n强度目标：沿用个人计划\\n结束后记录主观用力程度',23,16)
button(d,(1040,625,1418,689),'记录实际训练')
box(d,(270,750,1450,900)); text(d,(300,771),'有 1 条调整建议等待确认',27,b=True); text(d,(300,830),'周四时段缩短；锁定训练不变，确认后才保存。',23,MUTED); button(d,(1180,780,1415,855),'查看预览',False)
im.save(ASSET/'ui-athlete.png')

"""+s[b:]
# Remove table-spacer paragraphs immediately before an intentional new page.
old="def h(s,level=2,page=False):\n el=setp"
new="""def h(s,level=2,page=False):
 if page:
  prev=doc._element.body[-2]
  if prev.tag==qn('w:p') and not ''.join(prev.itertext()).strip() and not prev.findall('.//'+qn('w:drawing')): doc._element.body.remove(prev)
 el=setp"""
assert old in s;s=s.replace(old,new)
p.write_text(s,encoding='utf8')
print('Patched UI layouts, diagram connections and page-break spacers.')
