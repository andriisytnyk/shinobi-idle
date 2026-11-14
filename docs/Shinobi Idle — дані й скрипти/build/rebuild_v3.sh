set -e
cd /home/claude/work/build
python3 patch_v3.py
node build_map_v3.js "$(ls /mnt/user-data/uploads/*.html)" /home/claude/work/v3/skills_map_v3.html
node gen_md.js
cd /home/claude/work/tools && node validate_map_v3.js /home/claude/work/v3/skills_map_v3.html
