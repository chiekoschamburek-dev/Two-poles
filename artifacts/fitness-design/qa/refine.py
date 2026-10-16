from pathlib import Path
p=Path(r'D:\桌面\project\project\artifacts\fitness-design\build_document.py')
s=p.read_text(encoding='utf-8-sig')
s=s.replace('练得明白','两仪·TwoPoles')
s=s.replace("'大众与运动员双模式运动饮食助手'","'（个性化运动与饮食协同助手）'")
s=s.replace('拟开发“两仪·TwoPoles”双模式运动饮食助手','拟开发“两仪·TwoPoles（个性化运动与饮食协同助手）”')
s=s.replace("text(d,(35,22),'两仪·TwoPoles',34,'white',True); text(d,(240,31),'运动与饮食协同助手',24,'#c0d4e0')","text(d,(35,22),'两仪·TwoPoles',32,'white',True); text(d,(350,31),'个性化运动与饮食协同助手',24,'#c0d4e0')")
s=s.replace("text(d,(1203,29),mode+'  ▾',24,'white')","text(d,(1203,29),mode,24,'white'); d.polygon([(1423,40),(1439,40),(1431,49)],fill='white')")
s=s.replace('项目区分度在于双模式的可解释训练流程、低门槛跟练记录和训练饮食时间线的统一复盘。与已知分组选题中的二手交易、失物招领、家教和寻路方向不同；饮食部分服务于运动主线，最终与“食迹（FoodWise）”的边界需以双方功能范围核对。','项目区分度在于双模式的可解释训练流程、低门槛跟练记录和训练饮食时间线的统一复盘。系统以个人运动过程为主线，饮食模块提供配套结构参考；将交互式训练执行、条件替换、计划变更确认作为主要实现重点。')
s=s.replace("h(f'4.{i} {name}',2)","h(f'4.{i} {name}',2,page=i in (3,5,7))")
s=s.replace("fig('ui-food','图6-4 可编辑餐盘与训练日时间线原型')","fig('ui-food','图6-4 可编辑餐盘与训练日时间线原型',width=14.2)")
s=s.replace("h('9. 预期成果',1)","h('9. 预期成果',1,True)")
s=s.replace("h('参考资料',1,True)","h('参考资料',1)")
s=s.replace("('p','s','用户 1 : N')","('u','s','1 : N')")
# draw the User-to-Session edge along an exterior path so it does not imply a Profile foreign key
old="x,y,_,_=nodes[a]; xx,yy,_,_=nodes[b]; arrow(d,(x+140,y+95),(xx+140,yy)); text(d,((x+xx)//2+145,(y+yy)//2+45),label,21,MUTED)"
new="""x,y,_,_=nodes[a]; xx,yy,_,_=nodes[b]
 if a=='u' and b=='s':
  d.line([(590,155),(35,155),(35,760)],fill='#7c91a2',width=4); arrow(d,(35,760),(70,760)); text(d,(40,600),'1 : N',21,MUTED)
 else:
  arrow(d,(x+140,y+95),(xx+140,yy)); text(d,((x+xx)//2+145,(y+yy)//2+45),label,21,MUTED)"""
assert old in s;s=s.replace(old,new)
s=s.replace('Garmin. Garmin Support Center：Training Load相关说明. https://support.garmin.com/ （检索词：Training Load；访问日期：2026-10-13）。','Garmin. What Is Training Load on My Garmin Device? https://support.garmin.com/en-CA/navionics/faq/SEkNpdGyhR917js0qQL3Q6 （访问日期：2026-10-13）。')
s=s.replace('MyFitnessPal. Help Center：Food Diary与Nutrition相关说明. https://support.myfitnesspal.com/ （访问日期：2026-10-13）。','MyFitnessPal. Food Logging. https://support.myfitnesspal.com/hc/en-us/sections/360006073671-FOOD-DIARY-AND-FOOD-DATABASE （访问日期：2026-10-13）。')
s=s.replace('官方信息：https://www.cnsoc.org/','官方八准则：https://dg.cnsoc.org/newslist_0402_1.htm')
s=s.replace('标准姿势；保存模型版本','标准姿势；保存模型版本')
# Keep short paragraphs together to avoid a two-line continuation before the algorithm section.
s=s.replace('p.paragraph_format.widow_control=True','p.paragraph_format.widow_control=True; p.paragraph_format.keep_together=True')
p.write_text(s,encoding='utf-8')
