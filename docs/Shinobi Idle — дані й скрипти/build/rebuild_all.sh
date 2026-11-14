set -e
# Повна перебудова: карта навичок v3, фрагменти, концепт v3 і рішення MVP, копії в out/.
bash /home/claude/work/build/rebuild_v3.sh
cd /home/claude/work/v3
python3 edit_concept.py
python3 patch_mvp_story.py
cp concept_v3.md "/home/claude/work/out/Shinobi Idle — гейм-дизайн концепт v3.md"
cp skills_map_v3.html "/home/claude/work/out/Shinobi Idle — карта навичок v3.html"
echo "rebuild_all ok"
