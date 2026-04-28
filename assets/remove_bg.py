from PIL import Image
import glob

def remove_background(filepath):
    print(f"Processing {filepath}...")
    img = Image.open(filepath).convert('RGBA')
    pixels = img.load()
    width, height = img.size
    
    # We will do a BFS from the edges
    visited = set()
    queue = []
    
    # Add all edge pixels
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
        
    for x, y in queue:
        visited.add((x, y))
        
    head = 0
    while head < len(queue):
        cx, cy = queue[head]
        head += 1
        
        r, g, b, a = pixels[cx, cy]
        # Check if it's a light gray/white checkerboard pixel
        if r > 190 and g > 190 and b > 190 and a > 0:
            pixels[cx, cy] = (0, 0, 0, 0) # Make transparent
            
            # Add 8-way neighbors
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        if (nx, ny) not in visited:
                            visited.add((nx, ny))
                            queue.append((nx, ny))

    img.save(filepath)

files = glob.glob('/Users/joseochoa/Desktop/pixel-math/assets/enemy_*.png') + ['/Users/joseochoa/Desktop/pixel-math/assets/player_mage.png']
for f in files:
    remove_background(f)
print("Done!")
