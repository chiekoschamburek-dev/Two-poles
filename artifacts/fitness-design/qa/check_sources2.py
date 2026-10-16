import urllib.request, re, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
urls=[
'https://api.crossref.org/works?query.title=A%20new%20approach%20to%20monitoring%20exercise%20training&rows=1',
'https://connect.garmin.com/',
'https://www.myfitnesspal.com/',
'http://dg.cnsoc.org/newslist_0402_1.htm',
'https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js?hl=en',
'https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/training-load/']
def fetch(u):
 try:
  req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=25) as r: data=r.read();url=r.url;status=r.status
  s=data.decode('utf8','replace');title=re.search(r'<title[^>]*>(.*?)</title>',s,re.S)
  meta=re.findall(r'<meta[^>]+(?:citation_title|citation_doi|citation_date|citation_firstpage|citation_lastpage|citation_journal_title)[^>]+>',s,re.I)
  return {'url':u,'final':url,'status':status,'title': re.sub(r'\s+',' ',title.group(1)) if title else '', 'meta':meta,'bytes':len(data), 'snippet':s[:8000] if 'api.crossref.org' in u else ''}
 except Exception as e:return {'url':u,'error':str(e)}
r=list(ThreadPoolExecutor(8).map(fetch,urls))
Path('artifacts/fitness-design/qa/source-check.json').write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(r,ensure_ascii=False,indent=2))
