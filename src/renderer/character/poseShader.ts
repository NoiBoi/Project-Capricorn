/** Local cutout rig inspired by Capri Desktop's inverse-sampling mane/leg shader.
 * No color grading, glitter generation, outline or postprocessing is applied. */
const VERTEX = `attribute vec2 aPosition; varying vec2 uv;
void main(){uv=vec2((aPosition.x+1.0)*0.5,(1.0-aPosition.y)*0.5);gl_Position=vec4(aPosition,0.0,1.0);}`;
const FRAGMENT = `precision highp float;
varying vec2 uv; uniform sampler2D uImage; uniform vec4 uCrop;
uniform float uTime; uniform float uMotion; uniform float uRecline;
vec2 turn(vec2 p,vec2 pivot,float angle){float s=sin(angle),c=cos(angle);p-=pivot;return pivot+mat2(c,-s,s,c)*p;}
void main(){
 vec2 q=uv;
 // Fine irregular mane lag, with the face and contact point pinned.
 vec2 face=mix(vec2(0.53,0.515),vec2(0.72,0.73),uRecline);
 float faceHold=1.0-smoothstep(0.075,0.19,distance(q,face));
 float hair=mix(1.0-smoothstep(0.44,0.61,q.y),smoothstep(0.55,0.72,q.x),uRecline)*(1.0-faceHold);
 float breathe=sin(uTime*1.05)*0.004*uMotion;
 q.x-=(sin(uTime*0.82+q.y*4.1)*0.030+sin(uTime*1.37-q.y*6.0)*0.009)*hair*uMotion;
 q.y-=sin(uTime*0.69+q.x*5.0)*0.014*hair*uMotion;
 // The seated lower leg swings from its knee, rather than sliding image bands.
 float foot=smoothstep(0.79,0.89,q.y)*smoothstep(0.53,0.66,q.x)*(1.0-uRecline);
 q=mix(q,turn(q,vec2(0.72,0.82),sin(uTime*1.2)*0.075*uMotion),foot);
 // Reclining raised ankle flexes subtly, while the supporting hip stays fixed.
 float ankle=(1.0-smoothstep(0.30,0.47,q.x))*(1.0-smoothstep(0.38,0.65,q.y))*uRecline;
 q=mix(q,turn(q,vec2(0.35,0.67),sin(uTime*0.72)*0.04*uMotion),ankle);
 q.y-=breathe*(1.0-smoothstep(0.68,0.79,q.y))*(1.0-faceHold);
 if(q.x<0.0||q.x>1.0||q.y<0.0||q.y>1.0){gl_FragColor=vec4(0.0);return;}
 gl_FragColor=texture2D(uImage,uCrop.xy+q*uCrop.zw);
}`;

export class PoseShader {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private textures = new Map<HTMLImageElement, WebGLTexture>();
  private lost = false;
  private tried = false;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  get available() { return !!this.program && !this.lost; }
  constructor() {
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.tried = false; this.program = null; this.textures.clear(); });
  }
  private initialize() {
    if (this.tried || this.lost) return;
    this.tried = true;
    const gl = this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; } return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return;
    const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    this.program = program; gl.useProgram(program);
    for (const name of ['uImage', 'uCrop', 'uTime', 'uMotion', 'uRecline']) this.uniforms[name] = gl.getUniformLocation(program, name);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1); gl.disable(gl.BLEND);
  }
  render(image: HTMLImageElement, crop: readonly number[], width: number, height: number, time: number, motion: number, reclining: boolean) {
    this.initialize();
    const gl = this.gl, program = this.program;
    if (!gl || !program || this.lost) return null;
    const w = Math.max(1, Math.min(1024, Math.ceil(width))), h = Math.max(1, Math.min(1024, Math.ceil(height)));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.useProgram(program);
    let texture = this.textures.get(image);
    if (!texture) {
      texture = gl.createTexture()!; this.textures.set(image, texture); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } else gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniforms.uImage, 0);
    gl.uniform4f(this.uniforms.uCrop, crop[0]/image.width, crop[1]/image.height, crop[2]/image.width, crop[3]/image.height);
    gl.uniform1f(this.uniforms.uTime, time); gl.uniform1f(this.uniforms.uMotion, motion);
    gl.uniform1f(this.uniforms.uRecline, reclining ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }
}
