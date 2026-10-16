from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageDraw, ImageFont
root=Path(r'D:\桌面\project\project\artifacts\fitness-design\qa')
pages=PdfReader(root/'final-v3.pdf').pages
for i,p in enumerate(pages):
 t=p.extract_text() or ''
 print(f'{i+1:02d} ({len(t):4d}) {t[50:130]!r} ... {t[-100:]!r}')
imgs=sorted((root/'final-v3-render').glob('page-*.png'))
for start in range(0,len(imgs),4):
 sheet=Image.new('RGB',(1260,1830),'#c6cbd1');d=ImageDraw.Draw(sheet)
 for j,p in enumerate(imgs[start:start+4]):
  im=Image.open(p); im.thumbnail((605,865));x=15+(j%2)*630;y=35+(j//2)*910
  sheet.paste(im,(x,y));d.text((x,y-22),str(start+j+1),fill='black',font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20))
 sheet.save(root/f'v3-review-{start//4+1}.png')
