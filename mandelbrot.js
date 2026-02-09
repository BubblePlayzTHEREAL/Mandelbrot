// Mandelbrot Set Viewer with GPU acceleration using WebGL
class MandelbrotViewer {
    constructor(customWidth = null, customHeight = null) {
        this.canvas = document.getElementById('canvas');
        this.gl = this.canvas.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        
        if (!this.gl) {
            alert('WebGL is not supported in your browser!');
            return;
        }

        // Static resolution - defaults to user's initial resolution or custom resolution
        this.renderWidth = customWidth || window.innerWidth;
        this.renderHeight = customHeight || window.innerHeight;

        // Iteration calculation constants
        this.BASE_ITERATIONS = 512;
        this.ZOOM_MULTIPLIER = 50; // Scales iterations logarithmically with zoom level
        this.INITIAL_ITERATIONS = 2000; // High quality initial view

        // View parameters
        this.centerX = -0.5;
        this.centerY = 0.0;
        this.zoom = 1.0;
        this.maxIterations = this.INITIAL_ITERATIONS;

        // Mouse state
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Keyboard state
        this.keys = {};

        // FPS tracking
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.fps = 0;

        this.init();
        this.setupEventListeners();
        this.animate();
    }

    init() {
        this.resizeCanvas();
        this.setupShaders();
        this.setupGeometry();
    }

    resizeCanvas() {
        // Set canvas to static resolution (defaults to user's initial resolution)
        this.canvas.width = this.renderWidth;
        this.canvas.height = this.renderHeight;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    setupShaders() {
        const vertexShaderSource = `
            attribute vec2 a_position;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;

        const fragmentShaderSource = `
            precision highp float;
            uniform vec2 u_resolution;
            uniform vec4 u_center; // xy = high, zw = low (for double precision)
            uniform vec2 u_zoom;   // x = high, y = low (for double precision)
            uniform int u_maxIterations;

            // Double-single (DS) arithmetic for extended precision
            // Each DS number is represented as (high, low) where high + low = value
            
            // DS addition: (a_hi, a_lo) + (b_hi, b_lo)
            vec2 ds_add(vec2 a, vec2 b) {
                float s = a.x + b.x;
                float v = s - a.x;
                float e = (a.x - (s - v)) + (b.x - v);
                e = e + a.y + b.y;
                float z = s + e;
                return vec2(z, e - (z - s));
            }
            
            // DS subtraction: (a_hi, a_lo) - (b_hi, b_lo)
            vec2 ds_sub(vec2 a, vec2 b) {
                float s = a.x - b.x;
                float v = s - a.x;
                float e = (a.x - (s - v)) - (b.x + v);
                e = e + a.y - b.y;
                float z = s + e;
                return vec2(z, e - (z - s));
            }
            
            // DS multiplication: (a_hi, a_lo) * (b_hi, b_lo)
            // Using Dekker's algorithm for accurate product
            vec2 ds_mul(vec2 a, vec2 b) {
                float p = a.x * b.x;
                // Calculate the rounding error using Dekker split
                const float split = 4097.0; // 2^12 + 1
                float t1 = a.x * split;
                float a_hi = t1 - (t1 - a.x);
                float a_dekker_lo = a.x - a_hi;
                float t2 = b.x * split;
                float b_hi = t2 - (t2 - b.x);
                float b_dekker_lo = b.x - b_hi;
                
                float e = ((a_hi * b_hi - p) + a_hi * b_dekker_lo + a_dekker_lo * b_hi) + a_dekker_lo * b_dekker_lo;
                e = e + a.x * b.y + a.y * b.x + a.y * b.y;
                float z = p + e;
                return vec2(z, e - (z - p));
            }
            
            // Split a float into high and low parts for DS representation
            vec2 ds_set(float a) {
                const float split = 4097.0; // 2^12 + 1 for splitting
                float t = a * split;
                float a_hi = t - (t - a);
                float a_lo = a - a_hi;
                return vec2(a_hi, a_lo);
            }
            
            // Compare DS number squared magnitude with threshold squared
            bool ds_length_squared_greater(vec2 x, vec2 y, float threshold_squared) {
                // Compute x^2 + y^2 in DS arithmetic
                vec2 xx = ds_mul(x, x);
                vec2 yy = ds_mul(y, y);
                vec2 sum = ds_add(xx, yy);
                return sum.x > threshold_squared;
            }

            vec3 palette(float t) {
                vec3 a = vec3(0.5, 0.5, 0.5);
                vec3 b = vec3(0.5, 0.5, 0.5);
                vec3 c = vec3(1.0, 1.0, 1.0);
                vec3 d = vec3(0.0, 0.33, 0.67);
                return a + b * cos(6.28318 * (c * t + d));
            }

            void main() {
                vec2 uv = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
                uv.x *= u_resolution.x / u_resolution.y;
                
                // Convert uv to DS format
                vec2 uv_x_ds = ds_set(uv.x);
                vec2 uv_y_ds = ds_set(uv.y);
                
                // Use zoom as DS and divide
                // uv / zoom in DS arithmetic
                vec2 zoom_ds = u_zoom;
                
                // Simple division approximation for DS: a / b ≈ a * (1/b)
                // For better accuracy at extreme zooms, we compute 1/zoom in DS
                float inv_zoom_hi = 1.0 / zoom_ds.x;
                // Refine: inv_zoom_lo = (1 - inv_zoom_hi * zoom) / zoom
                float error = 1.0 - inv_zoom_hi * zoom_ds.x - inv_zoom_hi * zoom_ds.y;
                float inv_zoom_lo = error / zoom_ds.x;
                vec2 inv_zoom_ds = vec2(inv_zoom_hi, inv_zoom_lo);
                
                uv_x_ds = ds_mul(uv_x_ds, inv_zoom_ds);
                uv_y_ds = ds_mul(uv_y_ds, inv_zoom_ds);
                
                // Add center in DS arithmetic
                // u_center = (x_hi, x_lo, y_hi, y_lo)
                vec2 c_x = ds_add(vec2(u_center.x, u_center.y), uv_x_ds);
                vec2 c_y = ds_add(vec2(u_center.z, u_center.w), uv_y_ds);
                
                // Mandelbrot iteration with DS arithmetic
                vec2 z_x = vec2(0.0, 0.0);
                vec2 z_y = vec2(0.0, 0.0);
                int i = 0;
                float final_length_squared = 0.0;
                const float ESCAPE_RADIUS_SQUARED = 4.0; // 2.0^2
                
                for (int iter = 0; iter < 100000; iter++) {
                    if (iter >= u_maxIterations) break;
                    i = iter;
                    
                    // z = z^2 + c
                    // z_new.x = z.x^2 - z.y^2 + c.x
                    // z_new.y = 2 * z.x * z.y + c.y
                    
                    vec2 zx_sq = ds_mul(z_x, z_x);
                    vec2 zy_sq = ds_mul(z_y, z_y);
                    vec2 zx_zy = ds_mul(z_x, z_y);
                    
                    vec2 new_z_x = ds_add(ds_sub(zx_sq, zy_sq), c_x);
                    vec2 new_z_y = ds_add(ds_add(zx_zy, zx_zy), c_y);
                    
                    z_x = new_z_x;
                    z_y = new_z_y;
                    
                    // Check if squared magnitude > 4.0
                    if (ds_length_squared_greater(z_x, z_y, ESCAPE_RADIUS_SQUARED)) {
                        final_length_squared = z_x.x * z_x.x + z_y.x * z_y.x;
                        break;
                    }
                }
                
                // If we didn't escape, compute final squared magnitude anyway for consistency
                if (final_length_squared == 0.0) {
                    final_length_squared = z_x.x * z_x.x + z_y.x * z_y.x;
                }
                
                // Coloring
                if (i >= u_maxIterations - 1) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                } else {
                    // Smooth coloring using squared length
                    // Guard against log of very small or zero values
                    float safe_length_squared = max(final_length_squared, 0.0001);
                    float smoothI = float(i) - log2(log2(sqrt(safe_length_squared)));
                    float t = smoothI / float(u_maxIterations);
                    vec3 color = palette(t);
                    gl_FragColor = vec4(color, 1.0);
                }
            }
        `;

        // Compile shaders
        const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        // Create program
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            console.error('Program linking error:', this.gl.getProgramInfoLog(this.program));
            return;
        }

        this.gl.useProgram(this.program);

        // Get attribute and uniform locations
        this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
        this.centerLocation = this.gl.getUniformLocation(this.program, 'u_center');
        this.zoomLocation = this.gl.getUniformLocation(this.program, 'u_zoom');
        this.maxIterationsLocation = this.gl.getUniformLocation(this.program, 'u_maxIterations');
    }

    // Split a double into high and low parts for double-single arithmetic
    // This uses the Dekker split algorithm to separate a float64 into two parts
    splitDouble(value) {
        // Use Dekker splitting with a constant appropriate for splitting float64 into float32 pairs
        // The split constant is 2^27 + 1 for float64 -> float32 precision
        const split = 134217729.0; // 2^27 + 1
        
        const temp = value * split;
        const high = temp - (temp - value);
        const low = value - high;
        
        return [high, low];
    }

    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    setupGeometry() {
        // Create a full-screen quad
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1,
        ]);

        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
    }

    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                
                const pixelSize = 2.0 / (this.canvas.height * this.zoom);
                this.centerX -= dx * pixelSize * (this.canvas.width / this.canvas.height);
                this.centerY += dy * pixelSize;
                
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                
                this.updateInfo();
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
        });

        // Mouse wheel for zooming
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            
            // Zoom towards mouse position
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const uv = [(mouseX / this.canvas.width) * 2 - 1, 1 - (mouseY / this.canvas.height) * 2];
            uv[0] *= this.canvas.width / this.canvas.height;
            
            const worldPos = [
                this.centerX + uv[0] / this.zoom,
                this.centerY + uv[1] / this.zoom
            ];
            
            this.zoom *= zoomFactor;
            
            this.centerX = worldPos[0] - uv[0] / this.zoom;
            this.centerY = worldPos[1] - uv[1] / this.zoom;
            
            // Increase iterations as we zoom in
            this.maxIterations = this.calculateIterations(this.zoom);
            
            this.updateInfo();
        });

        // Keyboard events
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            // Reset view with R key
            if (e.key.toLowerCase() === 'r') {
                this.centerX = -0.5;
                this.centerY = 0.0;
                this.zoom = 1.0;
                this.maxIterations = this.INITIAL_ITERATIONS;
                this.updateInfo();
            }
            
            // Zoom with +/- keys
            if (e.key === '+' || e.key === '=') {
                this.zoom *= 1.1;
                this.maxIterations = this.calculateIterations(this.zoom);
                this.updateInfo();
            }
            if (e.key === '-' || e.key === '_') {
                this.zoom *= 0.9;
                this.maxIterations = this.calculateIterations(this.zoom);
                this.updateInfo();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    handleKeyboardPanning() {
        const panSpeed = 0.05 / this.zoom;
        
        // Arrow keys and WASD
        if (this.keys['arrowleft'] || this.keys['a']) {
            this.centerX -= panSpeed;
        }
        if (this.keys['arrowright'] || this.keys['d']) {
            this.centerX += panSpeed;
        }
        if (this.keys['arrowup'] || this.keys['w']) {
            this.centerY += panSpeed;
        }
        if (this.keys['arrowdown'] || this.keys['s']) {
            this.centerY -= panSpeed;
        }
        
        // Update info if any key is pressed
        if (this.keys['arrowleft'] || this.keys['arrowright'] || 
            this.keys['arrowup'] || this.keys['arrowdown'] ||
            this.keys['a'] || this.keys['d'] || this.keys['w'] || this.keys['s']) {
            this.updateInfo();
        }
    }

    updateInfo() {
        document.getElementById('zoom').textContent = this.zoom.toFixed(2);
        document.getElementById('centerX').textContent = this.centerX.toFixed(6);
        document.getElementById('centerY').textContent = this.centerY.toFixed(6);
        document.getElementById('iterations').textContent = this.maxIterations;
    }

    calculateIterations(zoom) {
        // Ensure zoom is positive to avoid Math.log2 returning -Infinity or NaN
        const safeZoom = Math.max(zoom, 1.0);
        return Math.floor(this.BASE_ITERATIONS + Math.log2(safeZoom) * this.ZOOM_MULTIPLIER);
    }

    updateFPS() {
        this.frameCount++;
        const currentTime = performance.now();
        const elapsed = currentTime - this.lastTime;
        
        if (elapsed >= 1000) {
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            document.getElementById('fps').textContent = this.fps;
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }

    render() {
        this.handleKeyboardPanning();
        
        // Clear canvas
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Use program
        this.gl.useProgram(this.program);

        // Split coordinates into high and low parts for double precision
        const [centerXHi, centerXLo] = this.splitDouble(this.centerX);
        const [centerYHi, centerYLo] = this.splitDouble(this.centerY);
        const [zoomHi, zoomLo] = this.splitDouble(this.zoom);

        // Set uniforms
        this.gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        // Pack as (x_hi, x_lo, y_hi, y_lo) to match shader's usage
        this.gl.uniform4f(this.centerLocation, centerXHi, centerXLo, centerYHi, centerYLo);
        this.gl.uniform2f(this.zoomLocation, zoomHi, zoomLo);
        this.gl.uniform1i(this.maxIterationsLocation, this.maxIterations);

        // Bind buffer and set attribute
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Draw
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        this.updateFPS();
    }

    animate() {
        this.render();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize when page loads
// The viewer uses a static resolution that defaults to the user's initial screen resolution
// To use a custom resolution, pass width and height parameters:
// new MandelbrotViewer(1920, 1080); // For 1920x1080 resolution
// new MandelbrotViewer(2560, 1440); // For 2560x1440 resolution
// Or call with no parameters to use the current window size:
window.addEventListener('DOMContentLoaded', () => {
    new MandelbrotViewer();
});
