/**
 * The living backdrop: a slow, domain-warped swirl rendered at 1/3 resolution and stretched with
 * nearest-neighbour scaling, so it reads as chunky moving pixels. Money moments tint it.
 */

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `
precision mediump float;
uniform vec2 r; uniform float t; uniform vec3 pc; uniform float pa; uniform float heat;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r.y; float tt=t*.035;
  vec2 q=vec2(fbm(uv*1.4+tt),fbm(uv*1.4+vec2(5.2,1.3)-tt));
  vec2 w=vec2(fbm(uv*1.1+1.8*q+vec2(1.7,9.2)+tt*.6),fbm(uv*1.1+1.8*q+vec2(8.3,2.8)-tt*.5));
  float f=fbm(uv*1.2+2.2*w);
  vec3 a=vec3(.012,.050,.042), b=vec3(.030,.150,.118), c=vec3(.085,.330,.250);
  vec3 col=mix(a,b,smoothstep(.25,.68,f));
  col=mix(col,c,smoothstep(.58,.9,f)*.75);
  col=mix(col,vec3(.16,.035,.04),heat*smoothstep(.45,.9,w.x)*.55);
  col=floor(col*48.)/48.;
  col+=pc*pa*smoothstep(.35,.95,f);
  vec2 d=gl_FragCoord.xy/r-.5; col*=1.-dot(d,d)*.7;
  gl_FragColor=vec4(col,1.);
}`;

const COLORS = { mint: [0.16, 0.55, 0.38], red: [0.6, 0.08, 0.12], amber: [0.55, 0.38, 0.06] } as const;

export interface Backdrop {
  pulse(color: keyof typeof COLORS, strength?: number): void;
  setHeat(v: number): void;
  boost(seconds: number): void;
}

export function startBackdrop(canvas: HTMLCanvasElement, reduced: boolean): Backdrop {
  const noop: Backdrop = { pulse: () => {}, setHeat: () => {}, boost: () => {} };
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) { canvas.classList.add('nogl'); return noop; }
  const sh = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) { canvas.classList.add('nogl'); return noop; }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('nogl'); return noop; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, 'r');
  const uT = gl.getUniformLocation(prog, 't');
  const uPc = gl.getUniformLocation(prog, 'pc');
  const uPa = gl.getUniformLocation(prog, 'pa');
  const uHeat = gl.getUniformLocation(prog, 'heat');

  let pulseColor: readonly number[] = COLORS.mint;
  let pulseAmt = 0;
  let heat = 0;
  let heatShown = 0;
  let time = 30;
  let speed = 1;
  let last = performance.now();
  const SCALE = 3;

  const resize = (): void => {
    const w = Math.max(1, Math.ceil(window.innerWidth / SCALE));
    const hgt = Math.max(1, Math.ceil(window.innerHeight / SCALE));
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); }
  };
  window.addEventListener('resize', resize);
  resize();

  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduced) time += dt * speed;
    speed += (1 - speed) * Math.min(1, dt * 1.5);
    pulseAmt *= Math.pow(0.18, dt);
    heatShown += (heat - heatShown) * Math.min(1, dt * 2);
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, time);
    gl.uniform3f(uPc, pulseColor[0] ?? 0, pulseColor[1] ?? 0, pulseColor[2] ?? 0);
    gl.uniform1f(uPa, pulseAmt);
    gl.uniform1f(uHeat, heatShown);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    pulse(color, strength = 1) { pulseColor = COLORS[color]; pulseAmt = Math.min(1.4, pulseAmt + strength); },
    setHeat(v) { heat = Math.max(0, Math.min(1, v)); },
    boost(seconds) { if (!reduced) speed = 1 + seconds * 6; },
  };
}
