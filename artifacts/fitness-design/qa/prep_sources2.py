from pathlib import Path
p=Path('artifacts/fitness-design/qa/check_sources.py')
s=p.read_text(encoding='utf-8-sig')
a=s.index('urls=[');b=s.index('\ndef fetch',a)
s=s[:a]+'''urls=[
'https://api.crossref.org/works?query.title=A%20new%20approach%20to%20monitoring%20exercise%20training&rows=1',
'https://connect.garmin.com/',
'https://www.myfitnesspal.com/',
'http://dg.cnsoc.org/newslist_0402_1.htm',
'https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js?hl=en',
'https://www.garmin.com/en-US/garmin-technology/running-science/physiological-measurements/training-load/']'''+s[b:]
s=s.replace("'bytes':len(data)","'bytes':len(data), 'snippet':s[:8000] if 'api.crossref.org' in u else ''")
s=s.replace("'qa/source-check.json'","'qa/source-check-2.json'")
Path('artifacts/fitness-design/qa/check_sources2.py').write_text(s,encoding='utf8')
