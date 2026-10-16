from pathlib import Path
p=Path('artifacts/fitness-design/build_document.py');s=p.read_text(encoding='utf8');s=s.replace("'固定版本姿态模型\n动作示范与食物目录\n随部署预置，按需加载'", "'固定版本姿态模型\\n动作示范与食物目录\\n随部署预置，按需加载'");p.write_text(s,encoding='utf8')
