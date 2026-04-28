from PIL import Image
import glob

def remove_background(filepath):
    print(f"Processing {filepath}...")
    img = Image.open(filepath).convert('RGBA')
    pixels = img.load()
    width, height = img.size
    
    for x in range(width):
        for y in range(height):
            r, g, b, a = pixels[x, y]
            if a > 0:
                # The checkerboard is white/light-gray.
                # All these colors have high RGB and low variance between channels.
                if r > 180 and g > 180 and b > 180 and abs(r-g) < 20 and abs(r-b) < 20 and abs(g-b) < 20:
                    pixels[x, y] = (0, 0, 0, 0)
                    
    img.save(filepath)

files = glob.glob('/Users/joseochoa/Desktop/pixel-math/assets/enemy_*.png') + ['/Users/joseochoa/Desktop/pixel-math/assets/player_mage.png']
for f in files:
    remove_background(f)
print("Done!")
