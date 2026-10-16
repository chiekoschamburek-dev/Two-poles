from pathlib import Path
p=Path('artifacts/fitness-design/build_document.py');s=p.read_text(encoding='utf8')
s=s.replace("arrow(d,(390,255),(390,375));text(d,(75,298),'用户确认后提交摘要 / HTTPS · JSON',23,TEAL)","text(d,(450,303),'用户确认后提交摘要 / HTTPS · JSON',23,TEAL)")
s=s.replace("arrow(d,(340,470),(340,520));arrow(d,(810,470),(810,520))", "arrow(d,(390,255),(390,390));arrow(d,(340,470),(340,520));arrow(d,(810,470),(810,520))")
s=s.replace('账号哈希、模式、目标、器材、专项、周期','账号标识、密码哈希、模式、目标、器材、专项、周期')
a=s.index('refs=[');b=s.index('\nfor r in refs:',a)
refs=[
'[1] Garmin. Training Load. Garmin Technology. https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/training-load/ 。',
'[2] MyFitnessPal. 官方产品与饮食记录功能介绍. https://www.myfitnesspal.com/ 。',
'[3] Google AI Edge. Pose Landmarker for Web. https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js （在线技术指南；实现前复核具体版本）。',
'[4] 中国营养学会. 中国居民膳食指南（2022）. 北京：人民卫生出版社，2022. 八准则：http://dg.cnsoc.org/newslist_0402_1.htm 。',
'[5] World Health Organization. Physical activity. https://www.who.int/news-room/fact-sheets/detail/physical-activity 。',
'[6] Foster C, Florhaug JA, Franklin J, et al. A New Approach to Monitoring Exercise Training. Journal of Strength and Conditioning Research, 2001, 15(1):109–115. PMID:11708692.',
'[7] Vue.js. Introduction. https://vuejs.org/guide/introduction.html 。',
'[8] FastAPI. 官方文档. https://fastapi.tiangolo.com/ 。']
s=s[:a]+'refs='+repr(refs)+s[b:]
p.write_text(s,encoding='utf8')
