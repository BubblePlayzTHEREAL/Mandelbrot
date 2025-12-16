// Mandelbrot Set Viewer with GPU acceleration using WebGL
class MandelbrotViewer {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.gl = this.canvas.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        
        if (!this.gl) {
            alert('WebGL is not supported in your browser!');
            return;
        }

        // View parameters
        this.centerX = -0.5;
        this.centerY = 0.0;
        this.zoom = 1.0;
        this.maxIterations = 2000;

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
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
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
            uniform vec2 u_center;
            uniform float u_zoom;
            uniform int u_maxIterations;

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
                
                // Apply zoom and center
                vec2 c = u_center + uv / u_zoom;
                
                // Mandelbrot iteration
                vec2 z = vec2(0.0, 0.0);
                int i = 0;
                for (int iter = 0; iter < 100000; iter++) {
                    if (iter >= u_maxIterations) break;
                    i = iter;
                    
                    // z = z^2 + c
                    float x = (z.x * z.x - z.y * z.y) + c.x;
                    float y = (2.0 * z.x * z.y) + c.y;
                    z = vec2(x, y);
                    
                    if (length(z) > 2.0) break;
                }
                
                // Coloring
                if (i >= u_maxIterations - 1) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                } else {
                    // Smooth coloring
                    float smoothI = float(i) - log2(log2(length(z)));
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
            this.maxIterations = Math.floor(512 + Math.log2(this.zoom) * 50);
            
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
                this.maxIterations = 2000;
                this.updateInfo();
            }
            
            // Zoom with +/- keys
            if (e.key === '+' || e.key === '=') {
                this.zoom *= 1.1;
                this.maxIterations = Math.floor(512 + Math.log2(this.zoom) * 50);
                this.updateInfo();
            }
            if (e.key === '-' || e.key === '_') {
                this.zoom *= 0.9;
                this.maxIterations = Math.floor(512 + Math.log2(this.zoom) * 50);
                this.updateInfo();
            }
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
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

        // Set uniforms
        this.gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        this.gl.uniform2f(this.centerLocation, this.centerX, this.centerY);
        this.gl.uniform1f(this.zoomLocation, this.zoom);
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
window.addEventListener('DOMContentLoaded', () => {
    new MandelbrotViewer();
});
