# Mandelbrot Set Viewer

An interactive GPU-accelerated Mandelbrot Set viewer built with WebGL. Explore the infinite beauty of the Mandelbrot fractal with smooth zooming and panning controls.

## Features

- **GPU Acceleration**: Uses WebGL shaders for fast rendering on your graphics card
- **Interactive Controls**: 
  - Mouse wheel to zoom in/out
  - Click and drag to pan around
  - Arrow keys or WASD for keyboard panning
  - +/- keys for zoom control
  - R key to reset view
- **Real-time Performance**: Displays current FPS, zoom level, and coordinates
- **Smooth Coloring**: Beautiful gradient coloring with smooth iteration counting

## Usage

Simply open `index.html` in a modern web browser that supports WebGL (Chrome, Firefox, Edge, Safari).

### Using a Local Server

For the best experience, serve the files using a local HTTP server:

```bash
# Using Python 3
python -m http.server 8000

# Using Python 2
python -m SimpleHTTPServer 8000

# Using Node.js (with http-server package)
npx http-server

# Using PHP
php -S localhost:8000
```

Then open your browser to `http://localhost:8000`

### Controls

- **Mouse Wheel**: Zoom in/out at cursor position
- **Click & Drag**: Pan around the fractal
- **Arrow Keys / WASD**: Pan in any direction
- **+/- Keys**: Zoom in/out at center
- **R Key**: Reset to initial view

## How it Works

The viewer uses WebGL fragment shaders to calculate the Mandelbrot set in parallel on your GPU. Each pixel is computed independently, allowing for real-time exploration even at high zoom levels. The shader automatically increases the maximum iteration count as you zoom in to maintain detail.

## Requirements

- Modern web browser with WebGL support
- Graphics card with WebGL capability

## Technical Details

- Uses WebGL 2.0 with fallback to WebGL 1.0
- Implements smooth iteration coloring for beautiful gradients
- Dynamic iteration count adjustment based on zoom level
- Full-screen canvas with responsive design
- Optimized shader code for maximum performance