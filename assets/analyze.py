from PIL import Image
import glob
import os

for f in glob.glob('/Users/joseochoa/Desktop/pixel-math/assets/enemy_*.png') + ['/Users/joseochoa/Desktop/pixel-math/assets/player_mage.png']:
    print(f)
    img = Image.open(f).convert('RGBA')
    colors = set()
    for x in range(32):
        for y in range(32):
            colors.add(img.getpixel((x, y)))
    print(colors)
