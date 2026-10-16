import urllib.request, re, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
urls=[
'https://pubmed.ncbi.nlm.nih.gov/11708692/',
'https://support.garmin.com/en-CA/navionics/faq/SEkNpdGyhR917js0qQL3Q6',
'https://support.myfitnesspal.com/hc/en-us/sections/360006073671-FOOD-DIARY-AND-FOOD-DATABASE',
'https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js',
'https://dg.cnsoc.org/newslist_0402_1.htm',
'https://www.who.int/news-room/fact-sheets/detail/physical-activity',
'https://vuejs.org/guide/introduction.html',
'https://fastapi.tiangolo.com/']
def fetch(u):
 try:
  req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=25) as r: data=r.read();url=r.url;status=r.status
  s=data.decode('utf8','replace');title=re.search(r'<title[^>]*>(.*?)</title>',s,re.S)
  meta=re.findall(r'<meta[^>]+(?:citation_title|citation_doi|citation_date|citation_firstpage|citation_lastpage|citation_journal_title)[^>]+>',s,re.I)
  return {'url':u,'final':url,'status':status,'title': re.sub(r'\s+',' ',title.group(1)) if title else '', 'meta':meta,'bytes':len(data)}
 except Exception as e:return {'url':u,'error':str(e)}
r=list(ThreadPoolExecutor(8).map(fetch,urls))
Path('artifacts/fitness-design/qa/source-check.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(r,ensure_ascii=False,indent=2))
