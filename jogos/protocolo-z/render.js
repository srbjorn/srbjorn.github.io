/*
 * Protocolo Z — o desenho, em WebGL 1.
 *
 * O cenário é montado uma vez por nível, com a luz das luminárias "assada"
 * nos vértices (com sombra: cada vértice pergunta ao mapa se enxerga a
 * lâmpada). O que se mexe — monstros, portas, a tampa da caixa, a arma na
 * mão — é transformado na CPU a cada quadro e vai num lote só. Por cima, as
 * luzes que piscam (clarão do tiro, explosão, raio) entram no shader, e os
 * brilhos (faíscas, rastros, ícones) são quadrados virados para a câmera.
 *
 * O vértice (15 números): x y z  nx ny nz  u v  r g b  luz(r g b)  emissivo.
 */
(function (PZ) {
"use strict"

const T = PZ.T
const M4 = PZ.M4
const Mod = PZ.Modelos
const NV = 15
const MAX_LUZES = 8

// ------------------------------------------------------------------ shaders

const VS = `
attribute vec3 a_pos;
attribute vec3 a_nrm;
attribute vec2 a_uv;
attribute vec3 a_cor;
attribute vec3 a_luz;
attribute float a_emis;
uniform mat4 u_vp;
varying vec3 v_pos;
varying vec3 v_nrm;
varying vec2 v_uv;
varying vec3 v_cor;
varying vec3 v_luz;
varying float v_emis;
void main() {
    v_pos = a_pos; v_nrm = a_nrm; v_uv = a_uv; v_cor = a_cor; v_luz = a_luz; v_emis = a_emis;
    gl_Position = u_vp * vec4(a_pos, 1.0);
}`

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
uniform vec3 u_cam;
uniform vec3 u_neblina;
uniform float u_dens;
uniform float u_emisTex;
uniform vec4 u_luzP[${MAX_LUZES}];
uniform vec3 u_luzC[${MAX_LUZES}];
uniform vec3 u_lanP;
uniform vec3 u_lanD;
uniform float u_lan;
uniform float u_sat;
varying vec3 v_pos;
varying vec3 v_nrm;
varying vec2 v_uv;
varying vec3 v_cor;
varying vec3 v_luz;
varying float v_emis;
void main() {
    vec4 tx = texture2D(u_tex, v_uv);
    vec3 base = tx.rgb * v_cor;
    vec3 n = normalize(v_nrm);
    vec3 luz = v_luz;
    for (int i = 0; i < ${MAX_LUZES}; i++) {
        vec3 d = u_luzP[i].xyz - v_pos;
        float l = length(d) + 0.0001;
        float a = clamp(1.0 - l / max(u_luzP[i].w, 0.001), 0.0, 1.0);
        luz += u_luzC[i] * a * a * (0.35 + 0.65 * max(dot(n, d / l), 0.0));
    }
    // a lanterna da viseira
    vec3 dl = v_pos - u_lanP;
    float ll = length(dl) + 0.0001;
    float cone = smoothstep(0.8, 0.96, dot(dl / ll, u_lanD));
    float al = clamp(1.0 - ll / 24.0, 0.0, 1.0);
    luz += vec3(0.55, 0.78, 0.9) * u_lan * cone * al * al * max(dot(n, -dl / ll), 0.0) * 1.3;
    vec3 c = base * luz + v_cor * v_emis + tx.rgb * (1.0 - tx.a) * u_emisTex;
    c = vec3(1.0) - exp(-c * 1.2);
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(g), c, u_sat);
    float dist = length(v_pos - u_cam);
    float f = 1.0 - exp(-u_dens * dist);
    gl_FragColor = vec4(mix(c, u_neblina, clamp(f, 0.0, 1.0)), 1.0);
}`

const VS_SPR = `
attribute vec3 a_pos;
attribute vec2 a_uv;
attribute vec4 a_cor;
uniform mat4 u_vp;
varying vec2 v_uv;
varying vec4 v_cor;
void main() { v_uv = a_uv; v_cor = a_cor; gl_Position = u_vp * vec4(a_pos, 1.0); }`

const FS_SPR = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
varying vec4 v_cor;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * v_cor; }`

function compilar(gl, vs, fs) {
    const sh = (tipo, src) => {
        const s = gl.createShader(tipo)
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
        return s
    }
    const p = gl.createProgram()
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
    const u = {}, a = {}
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < nu; i++) {
        const info = gl.getActiveUniform(p, i)
        const nome = info.name.replace(/\[0\]$/, "")
        u[nome] = gl.getUniformLocation(p, info.name)
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES)
    for (let i = 0; i < na; i++) {
        const info = gl.getActiveAttrib(p, i)
        a[info.name] = gl.getAttribLocation(p, info.name)
    }
    return { p: p, u: u, a: a }
}

// ------------------------------------------------------------------ texturas
// Pintadas pixel a pixel. O alfa é a máscara de brilho: 255 apagado, 0 aceso.

function ruido2(seed) {
    const r = PZ.sorteio(seed)
    const N = 64, g = new Float32Array(N * N)
    for (let i = 0; i < g.length; i++) g[i] = r()
    return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
        const a = g[((yi & 63) * N) + (xi & 63)], b = g[((yi & 63) * N) + ((xi + 1) & 63)]
        const c = g[(((yi + 1) & 63) * N) + (xi & 63)], d = g[(((yi + 1) & 63) * N) + ((xi + 1) & 63)]
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }
}

function pintar(tam, f) {
    const d = new Uint8Array(tam * tam * 4)
    for (let y = 0; y < tam; y++)
        for (let x = 0; x < tam; x++) {
            const c = f(x, y)
            const i = (y * tam + x) * 4
            d[i] = Math.max(0, Math.min(255, c[0])); d[i + 1] = Math.max(0, Math.min(255, c[1]))
            d[i + 2] = Math.max(0, Math.min(255, c[2])); d[i + 3] = c[3] === undefined ? 255 : c[3]
        }
    return d
}

function texturasDoTema(tema) {
    const N = 256
    const n1 = ruido2(11), n2 = ruido2(23), n3 = ruido2(37)
    const fbm = (x, y) => n1(x / 16, y / 16) * 0.5 + n2(x / 7, y / 7) * 0.3 + n3(x / 3, y / 3) * 0.2
    const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
    if (tema === "lab") return {
        piso: pintar(N, (x, y) => {
            const lx = x % 128, ly = y % 128
            const junta = lx < 3 || ly < 3
            const k = 0.92 + fbm(x, y) * 0.16 + ((Math.floor(x / 128) + Math.floor(y / 128)) % 2) * 0.04
            if (junta) return [70, 75, 84]
            const c = mul([150, 158, 170], k)
            if (lx > 8 && lx < 14 && ly > 8 && ly < 14) return [110, 115, 125]
            return c
        }),
        parede: pintar(N, (x, y) => {
            const lx = x % 128
            const junta = lx < 2 || y % 128 < 2
            const k = 0.94 + fbm(x, y) * 0.1
            if (junta) return [92, 98, 110]
            if ((lx === 10 || lx === 117) && (y % 128 === 10 || y % 128 === 117)) return [120, 126, 138]
            // um friso fino aceso no meio de cada placa
            if (y % 128 > 60 && y % 128 < 63 && lx > 20 && lx < 108) return [98, 236, 255, 90]
            return mul([196, 203, 216], k)
        }),
        teto: pintar(N, (x, y) => {
            const g = x % 64 < 3 || y % 64 < 3
            return g ? [60, 64, 72] : mul([128, 134, 146], 0.92 + fbm(x, y) * 0.12)
        })
    }
    if (tema === "fabrica") return {
        piso: pintar(N, (x, y) => {
            // chapa xadrez: losangos em relevo
            const u = (x + y) % 32, v = (x - y + 512) % 32
            const losango = (u > 12 && u < 18 && v > 4 && v < 26)
            const k = 0.82 + fbm(x, y) * 0.3
            const ferrugem = n2(x / 20, y / 20) > 0.72 ? 1 : 0
            let c = losango ? [104, 104, 110] : [74, 74, 80]
            if (ferrugem) c = [c[0] * 1.2 + 20, c[1] * 0.9, c[2] * 0.7]
            if (x % 128 < 2 || y % 128 < 2) c = [40, 38, 38]
            return mul(c, k)
        }),
        parede: pintar(N, (x, y) => {
            // chapa ondulada, com escorrido de ferrugem
            const onda = 0.8 + Math.sin(x / 256 * Math.PI * 2 * 12) * 0.2
            const escorre = n1(x / 6, y / 60) * n2(x / 3, 3) > 0.42 ? 0.75 : 1
            const k = (0.85 + fbm(x, y) * 0.25) * onda * escorre
            if (y % 128 < 3) return [50, 42, 36]
            return mul([150, 118, 92], k)
        }),
        teto: pintar(N, (x, y) => {
            const viga = x % 128 < 12 || y % 128 < 12
            return viga ? mul([60, 52, 44], 0.9 + fbm(x, y) * 0.2) : mul([38, 35, 33], 0.9 + fbm(x, y) * 0.2)
        })
    }
    if (tema === "estufa") return {
        piso: pintar(N, (x, y) => {
            // ladrilho molhado com musgo, e esporos acesos aqui e ali
            const lx = x % 64, ly = y % 64
            const k = 0.85 + fbm(x, y) * 0.25
            const musgo = n2(x / 18, y / 18) * 0.6 + n3(x / 5, y / 5) * 0.4
            if (lx < 2 || ly < 2) return musgo > 0.5 ? [40, 70, 34] : [44, 50, 46]
            if (musgo > 0.66 && n1(x / 2, y / 2) > 0.8) return [150, 255, 90, 120]
            if (musgo > 0.55) return mul([62, 104, 50], k)
            return mul([92, 104, 96], k)
        }),
        parede: pintar(N, (x, y) => {
            // vidraça escura num caixilho verde, com cipós acesos subindo
            const lx = x % 64, ly = y % 128
            if (lx < 5 || ly < 5) return mul([48, 66, 52], 0.9 + fbm(x, y) * 0.2)
            const cipo = Math.abs(((x + Math.sin(y / 14) * 9) % 64) - 32) < 2 && n1(x / 64, y / 30) > 0.6
            if (cipo) return [120, 255, 80, 160]
            const folha = n2(x / 6, y / 6) > 0.7 && n1(x / 40, y / 40) > 0.5
            if (folha) return mul([46, 96, 40], 0.9 + fbm(x, y) * 0.2)
            return mul([26, 46, 44], 0.85 + fbm(x, y) * 0.3)
        }),
        teto: pintar(N, (x, y) => {
            const g = x % 64 < 4 || y % 64 < 4
            return g ? [30, 40, 32] : mul([20, 34, 30], 0.9 + fbm(x, y) * 0.2)
        })
    }
    if (tema === "gelo") return {
        piso: pintar(N, (x, y) => {
            // chapa de metal com geada, e as juntas acesas de frio
            const lx = x % 128, ly = y % 128
            const k = 0.88 + fbm(x, y) * 0.18
            const geada = n2(x / 10, y / 10) * 0.6 + n3(x / 3, y / 3) * 0.4
            if (lx < 2 || ly < 2) return [120, 210, 240, 200]
            if ((lx > 8 && lx < 14) && (ly > 8 && ly < 14)) return [90, 104, 122]
            if (geada > 0.62) return mul([206, 228, 240], k)
            return mul([132, 150, 170], k)
        }),
        parede: pintar(N, (x, y) => {
            // painéis isolados, brancos de geada, com uma faixa acesa
            const lx = x % 128, ly = y % 128
            if (lx < 3 || ly < 3) return [80, 94, 112]
            if (ly > 96 && ly < 100) return [140, 230, 255, 90]
            const geada = n2(x / 8, y / 24) > 0.6
            const k = 0.9 + fbm(x, y) * 0.15
            return geada ? mul([222, 236, 246], k) : mul([168, 184, 202], k)
        }),
        teto: pintar(N, (x, y) => {
            const g = x % 64 < 4 || y % 64 < 4
            return g ? [70, 80, 96] : mul([120, 134, 152], 0.9 + fbm(x, y) * 0.15)
        })
    }
    return {
        piso: pintar(N, (x, y) => {
            // hexágonos escuros, com as juntas acesas
            const s = 32, hx = x / s, hy = y / (s * 0.866)
            const row = Math.floor(hy), off = row % 2 ? 0.5 : 0
            const cx = Math.floor(hx + off) - off + 0.5, cy = row + 0.5
            const dx = (hx - cx), dy = (hy - cy) * 0.866
            const dd = Math.max(Math.abs(dx) * 0.866 + Math.abs(dy) * 0.5, Math.abs(dy))
            const k = 0.85 + fbm(x, y) * 0.3
            if (dd > 0.475) return [150, 40, 175, 205]
            if (dd > 0.44) return [16, 12, 24]
            return mul([34, 28, 46], k)
        }),
        parede: pintar(N, (x, y) => {
            const k = 0.85 + fbm(x, y) * 0.25
            const traco = (x % 64 === 30 || x % 64 === 31) && n1(x / 64, y / 18) > 0.45
            const nodo = (x % 64 > 26 && x % 64 < 35 && y % 32 > 12 && y % 32 < 20) && n1(x / 64, y / 18) > 0.45
            if (traco || nodo) return [220, 70, 255, 70]
            if (x % 128 < 3 || y % 128 < 3) return [16, 12, 22]
            return mul([52, 42, 68], k)
        }),
        teto: pintar(N, (x, y) => {
            const g = x % 64 < 4 || y % 64 < 4
            return g ? [12, 9, 16] : mul([30, 25, 38], 0.9 + fbm(x, y) * 0.2)
        })
    }
}

/** Os desenhos dos brilhos: 8 × 8 células de 128 px. */
function atlasDeSprites() {
    const c = document.createElement("canvas")
    c.width = c.height = 1024
    const g = c.getContext("2d")
    const cel = (i, f) => { g.save(); g.translate((i % 8) * 128, Math.floor(i / 8) * 128); f(); g.restore() }
    const radial = (stops) => {
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62)
        for (const [o, cc] of stops) gr.addColorStop(o, cc)
        g.fillStyle = gr
        g.fillRect(0, 0, 128, 128)
    }
    // 0 brilho
    cel(0, () => radial([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]))
    // 1 faísca (estrela de quatro pontas)
    cel(1, () => {
        radial([[0, "rgba(255,255,255,1)"], [0.15, "rgba(255,255,255,0.4)"], [0.5, "rgba(255,255,255,0)"]])
        g.fillStyle = "#fff"
        g.beginPath(); g.moveTo(64, 2); g.lineTo(70, 58); g.lineTo(126, 64); g.lineTo(70, 70); g.lineTo(64, 126)
        g.lineTo(58, 70); g.lineTo(2, 64); g.lineTo(58, 58); g.closePath(); g.fill()
    })
    // 2 anel
    cel(2, () => { g.strokeStyle = "#fff"; g.lineWidth = 7; g.shadowColor = "#fff"; g.shadowBlur = 10; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke() })
    // 3 fumaça
    cel(3, () => {
        for (let i = 0; i < 14; i++) {
            const a = i * 2.4, r = 10 + (i % 5) * 6
            const gr = g.createRadialGradient(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0, 64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 34)
            gr.addColorStop(0, "rgba(255,255,255,0.22)"); gr.addColorStop(1, "rgba(255,255,255,0)")
            g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
        }
    })
    const icone = (i, desenha) => cel(i, () => {
        radial([[0, "rgba(255,255,255,0.35)"], [0.6, "rgba(255,255,255,0.15)"], [1, "rgba(255,255,255,0)"]])
        g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineWidth = 8; g.lineJoin = "round"; g.lineCap = "round"
        desenha()
    })
    // 4 munição
    icone(4, () => { for (let k = 0; k < 3; k++) { const x = 34 + k * 24; g.fillRect(x, 50, 16, 46); g.beginPath(); g.moveTo(x, 50); g.lineTo(x + 8, 32); g.lineTo(x + 16, 50); g.fill() } })
    // 5 crítico: a viseira com X X
    icone(5, () => {
        g.beginPath(); g.moveTo(24, 44); g.lineTo(104, 44); g.lineTo(96, 88); g.lineTo(32, 88); g.closePath(); g.stroke()
        for (const x of [48, 80]) { g.beginPath(); g.moveTo(x - 9, 57); g.lineTo(x + 9, 75); g.moveTo(x + 9, 57); g.lineTo(x - 9, 75); g.stroke() }
    })
    // 6 pontos em dobro
    icone(6, () => { g.font = "bold 62px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("x2", 64, 68) })
    // 7 EMP: o raio
    icone(7, () => { g.beginPath(); g.moveTo(72, 18); g.lineTo(38, 70); g.lineTo(62, 70); g.lineTo(54, 110); g.lineTo(92, 52); g.lineTo(66, 52); g.closePath(); g.fill() })
    // 8 sombra (escura, para mistura normal)
    cel(8, () => radial([[0, "rgba(0,0,0,0.75)"], [0.55, "rgba(0,0,0,0.45)"], [1, "rgba(0,0,0,0)"]]))
    // 9 clarão do cano
    cel(9, () => {
        radial([[0, "rgba(255,255,255,1)"], [0.2, "rgba(255,255,255,0.7)"], [0.55, "rgba(255,255,255,0)"]])
        g.fillStyle = "#fff"
        for (let k = 0; k < 6; k++) {
            g.save(); g.translate(64, 64); g.rotate(k * Math.PI / 3 + 0.3)
            g.beginPath(); g.moveTo(0, -6); g.lineTo(58 - (k % 2) * 18, 0); g.lineTo(0, 6); g.fill(); g.restore()
        }
    })
    // 10 pixel (o quadradinho do glitch)
    cel(10, () => { g.fillStyle = "#fff"; g.fillRect(24, 24, 80, 80) })
    // 11 onda de choque (anel grosso e borrado)
    cel(11, () => { g.strokeStyle = "#fff"; g.lineWidth = 14; g.shadowColor = "#fff"; g.shadowBlur = 16; g.beginPath(); g.arc(64, 64, 48, 0, 7); g.stroke() })
    // 12 recarga total: duas setas em volta
    icone(12, () => {
        g.beginPath(); g.arc(64, 64, 32, 0.3, Math.PI - 0.3); g.stroke()
        g.beginPath(); g.arc(64, 64, 32, Math.PI + 0.3, Math.PI * 2 - 0.3); g.stroke()
        for (const [x, y, a] of [[33, 54, -0.5], [95, 74, Math.PI - 0.5]]) {
            g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(-14, 0); g.lineTo(0, -16); g.lineTo(14, 0); g.closePath(); g.fill(); g.restore()
        }
    })
    // 13 escudo
    icone(13, () => { g.beginPath(); g.moveTo(64, 20); g.lineTo(100, 34); g.lineTo(96, 72); g.lineTo(64, 108); g.lineTo(32, 72); g.lineTo(28, 34); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(64, 36); g.lineTo(64, 92); g.stroke() })
    // 14 congelamento: o floco
    icone(14, () => {
        for (let k = 0; k < 3; k++) {
            g.save(); g.translate(64, 64); g.rotate(k * Math.PI / 3)
            g.beginPath(); g.moveTo(0, -42); g.lineTo(0, 42); g.stroke()
            for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, s * 26); g.lineTo(-12, s * 38); g.moveTo(0, s * 26); g.lineTo(12, s * 38); g.stroke() }
            g.restore()
        }
    })
    // 15 fúria: dois raios
    icone(15, () => {
        for (const dx of [-16, 16]) { g.beginPath(); g.moveTo(64 + dx + 6, 22); g.lineTo(46 + dx, 68); g.lineTo(62 + dx, 68); g.lineTo(56 + dx, 106); g.lineTo(82 + dx, 56); g.lineTo(66 + dx, 56); g.closePath(); g.fill() }
    })
    // 16 bônus: um cifrão de LED
    icone(16, () => { g.font = "bold 74px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 64, 68) })
    // 17 bomba atômica: o símbolo da radiação
    icone(17, () => {
        g.beginPath(); g.arc(64, 64, 9, 0, 7); g.fill()
        for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + k * Math.PI * 2 / 3
            g.beginPath(); g.moveTo(64 + Math.cos(a - 0.5) * 16, 64 + Math.sin(a - 0.5) * 16)
            g.arc(64, 64, 44, a - 0.5, a + 0.5); g.arc(64, 64, 16, a + 0.5, a - 0.5, true); g.closePath(); g.fill()
        }
    })
    // 18 presas vampiras: duas presas e uma gota
    icone(18, () => {
        for (const x of [44, 84]) { g.beginPath(); g.moveTo(x - 14, 30); g.lineTo(x + 14, 30); g.lineTo(x, 78); g.closePath(); g.fill() }
        g.beginPath(); g.moveTo(64, 74); g.quadraticCurveTo(80, 98, 64, 108); g.quadraticCurveTo(48, 98, 64, 74); g.fill()
    })
    // 19 robozinho: a cabeça com a viseira e as orelhas
    icone(19, () => {
        g.beginPath(); g.arc(64, 70, 34, 0, 7); g.fill()
        for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(64 + sx * 14, 42); g.lineTo(64 + sx * 34, 18); g.lineTo(64 + sx * 32, 48); g.closePath(); g.fill() }
        g.fillStyle = "#000"; g.fillRect(36, 60, 56, 20)
        g.fillStyle = "#fff"; g.fillRect(44, 66, 14, 8); g.fillRect(70, 66, 14, 8)
    })
    // 20 patas ligeiras: a marca da pata
    icone(20, () => {
        g.beginPath(); g.ellipse(64, 80, 24, 20, 0, 0, 7); g.fill()
        for (const [x, y] of [[34, 52], [52, 38], [76, 38], [94, 52]]) { g.beginPath(); g.ellipse(x, y, 10, 13, 0, 0, 7); g.fill() }
    })
    // 21 liquidação: o sinal de porcento
    icone(21, () => { g.font = "bold 76px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("%", 64, 68) })
    // 22 backup extra: um coração
    icone(22, () => {
        g.beginPath(); g.moveTo(64, 104)
        g.bezierCurveTo(16, 70, 22, 26, 64, 46); g.bezierCurveTo(106, 26, 112, 70, 64, 104); g.fill()
    })
    return c
}

// ------------------------------------------------------------------ o lote dinâmico

class Lote {
    constructor(gl, max) {
        this.gl = gl
        this.max = max
        this.d = new Float32Array(max * NV)
        this.n = 0
        this.buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
        gl.bufferData(gl.ARRAY_BUFFER, this.d.byteLength, gl.DYNAMIC_DRAW)
    }

    /**
     * Põe a geometria `g` transformada por `m`. `luz`: {amb, cor, dir} — a
     * luz do lugar, com uma direção para dar volume. `flash` clareia, `emis`
     * soma brilho, `tom` multiplica a cor.
     */
    geo(g, m, luz, flash, emis, tom) {
        const d = g.d, nv = d.length / 12
        if (this.n + nv > this.max) return
        const o = this.d
        let k = this.n * NV
        const a = luz.amb, lc = luz.cor, ld = luz.dir
        const fl = flash || 0, em = emis || 0
        const tr = tom ? tom[0] : 1, tg = tom ? tom[1] : 1, tb = tom ? tom[2] : 1
        // as matrizes são giro + escala uniforme: a normal só precisa desfazer a escala
        const esc = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) || 1, inv = 1 / esc
        const m0 = m[0] * inv, m1 = m[1] * inv, m2 = m[2] * inv, m4 = m[4] * inv, m5 = m[5] * inv, m6 = m[6] * inv
        const m8 = m[8] * inv, m9 = m[9] * inv, m10 = m[10] * inv
        for (let i = 0; i < d.length; i += 12) {
            const x = d[i], y = d[i + 1], z = d[i + 2], nx = d[i + 3], ny = d[i + 4], nz = d[i + 5]
            const mx = m0 * nx + m4 * ny + m8 * nz, my = m1 * nx + m5 * ny + m9 * nz, mz = m2 * nx + m6 * ny + m10 * nz
            o[k] = m[0] * x + m[4] * y + m[8] * z + m[12]
            o[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
            o[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
            o[k + 3] = mx; o[k + 4] = my; o[k + 5] = mz
            o[k + 6] = d[i + 6]; o[k + 7] = d[i + 7]
            o[k + 8] = d[i + 8] * tr; o[k + 9] = d[i + 9] * tg; o[k + 10] = d[i + 10] * tb
            const nd = Math.max(0, mx * ld[0] + my * ld[1] + mz * ld[2])
            const ceu = 0.75 + 0.25 * my
            o[k + 11] = a[0] * ceu + lc[0] * nd + fl
            o[k + 12] = a[1] * ceu + lc[1] * nd + fl
            o[k + 13] = a[2] * ceu + lc[2] * nd + fl
            o[k + 14] = d[i + 11] + em
            k += NV
        }
        this.n += nv
    }

    enviar() {
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
        if (this.n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.d.subarray(0, this.n * NV))
    }
}

// ------------------------------------------------------------------ o desenho

class Render {
    constructor(canvas) {
        const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" }) ||
                   canvas.getContext("experimental-webgl", { antialias: true, alpha: false })
        if (!gl) throw new Error("sem WebGL")
        this.gl = gl
        this.canvas = canvas
        this.prog = compilar(gl, VS, FS)
        this.spr = compilar(gl, VS_SPR, FS_SPR)
        this.lote = new Lote(gl, 170000)
        this.loteVM = new Lote(gl, 12000)
        this.sprD = new Float32Array(9 * 6 * 6000)
        this.sprN = 0
        this.sprBuf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf)
        gl.bufferData(gl.ARRAY_BUFFER, this.sprD.byteLength, gl.DYNAMIC_DRAW)
        this.branco = this.texDados(4, pintar(4, () => [255, 255, 255, 255]), false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        this.atlas = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, this.atlas)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasDeSprites())
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        const anis = gl.getExtension("EXT_texture_filter_anisotropic")
        this.anis = anis ? { ext: anis, max: Math.min(8, gl.getParameter(anis.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) } : null
        this.estatico = []
        this.fx = new Efeitos()
        this.w = 1; this.h = 1
    }

    texDados(tam, dados, repetir) {
        const gl = this.gl
        const t = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tam, tam, 0, gl.RGBA, gl.UNSIGNED_BYTE, dados)
        const w = repetir ? gl.REPEAT : gl.CLAMP_TO_EDGE
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w)
        if (repetir) {
            gl.generateMipmap(gl.TEXTURE_2D)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
            if (this.anis) gl.texParameterf(gl.TEXTURE_2D, this.anis.ext.TEXTURE_MAX_ANISOTROPY_EXT, this.anis.max)
        } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, repetir ? gl.LINEAR : gl.NEAREST)
        return t
    }

    tamanho(w, h) {
        if (w === this.w && h === this.h) return
        this.w = w; this.h = h
        this.canvas.width = w
        this.canvas.height = h
    }

    // -------------------------------------------------------------- o nível

    /**
     * Monta o cenário do mapa: chão, teto, paredes, colunas, máquinas,
     * luminárias e portais, com a luz assada. Portas e tampa ficam de fora
     * (mexem). `nivel` é a definição (cores, tema).
     */
    construirNivel(mapa, nivel) {
        const gl = this.gl
        for (const e of this.estatico) gl.deleteBuffer(e.buf)
        for (const t of this.texNivel || []) gl.deleteTexture(t)
        this.estatico = []
        this.nivel = nivel
        this.mapa = mapa
        const tex = texturasDoTema(nivel.tema)
        const tPiso = this.texDados(256, tex.piso, true)
        const tParede = this.texDados(256, tex.parede, true)
        const tTeto = this.texDados(256, tex.teto, true)
        this.texNivel = [tPiso, tParede, tTeto]

        // um mapa com as portas abertas: a luz passa pelos vãos
        const luzMapa = new PZ.Mapa(nivel)
        for (const p of luzMapa.portas) luzMapa.abrirPorta(p)
        this.luzMapa = luzMapa
        const luzes = mapa.luzes
        const amb = nivel.ambiente
        const cacheLuz = new Map()
        const luzEm = (x, y, z, nx, ny, nz) => {
            const ch = ((x * 100) | 0) + "," + ((y * 100) | 0) + "," + ((z * 100) | 0) + "," + nx + ny + nz
            const c = cacheLuz.get(ch)
            if (c) return c
            let r = amb[0], g = amb[1], b = amb[2]
            const px = x + nx * 0.06, py = y + ny * 0.06, pz = z + nz * 0.06
            for (const L of luzes) {
                const dx = L.x - px, dy = L.y - py, dz = L.z - pz
                const d = Math.hypot(dx, dy, dz)
                if (d > L.raio) continue
                const nd = (dx * nx + dy * ny + dz * nz) / (d || 1)
                if (nd <= -0.2) continue
                if (!luzMapa.visivel(L.x, L.y, L.z, px, py, pz)) continue
                const a = Math.pow(1 - d / L.raio, 2) * L.forca * (0.25 + 0.75 * Math.max(0, nd))
                r += L.cor[0] * a; g += L.cor[1] * a; b += L.cor[2] * a
            }
            const v = [r, g, b]
            cacheLuz.set(ch, v)
            return v
        }
        this.luzEm = luzEm

        const grupos = { piso: [], parede: [], teto: [], branco: [] }
        const push = (arr, x, y, z, nx, ny, nz, u, v, c, e) => {
            const l = luzEm(x, y, z, nx, ny, nz)
            arr.push(x, y, z, nx, ny, nz, u, v, c[0], c[1], c[2], l[0], l[1], l[2], e)
        }
        // um quadrilátero subdividido em pedaços de ~1 m (a luz fica suave)
        const quadSub = (arr, p0, du, dv, nu, nvv, n, uvf, c, e) => {
            for (let j = 0; j < nvv; j++)
                for (let i = 0; i < nu; i++) {
                    const P = (a, b) => [p0[0] + du[0] * a + dv[0] * b, p0[1] + du[1] * a + dv[1] * b, p0[2] + du[2] * a + dv[2] * b]
                    const a0 = i / nu, a1 = (i + 1) / nu, b0 = j / nvv, b1 = (j + 1) / nvv
                    const q = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)]
                    for (const k of [0, 1, 2, 0, 2, 3]) {
                        const uv = uvf(q[k])
                        push(arr, q[k][0], q[k][1], q[k][2], n[0], n[1], n[2], uv[0], uv[1], c, e)
                    }
                }
        }
        const W = [1, 1, 1]
        const teto = mapa.teto
        const parede = (c) => c === "#" || (c >= "1" && c <= "9")
        const cheio = (c) => parede(c) || c === "C" || c === "N"
        for (let z = 0; z < mapa.h; z++)
            for (let x = 0; x < mapa.w; x++) {
                const c = mapa.letra[mapa.idx(x, z)]
                const x0 = x * T, z0 = z * T
                if (!parede(c)) {
                    if (c !== "C" && c !== "N") {
                        quadSub(grupos.piso, [x0, 0, z0 + T], [T, 0, 0], [0, 0, -T], 2, 2, [0, 1, 0], (p) => [p[0] / T, p[2] / T], W, 0)
                        quadSub(grupos.teto, [x0, teto, z0], [T, 0, 0], [0, 0, T], 2, 2, [0, -1, 0], (p) => [p[0] / T, p[2] / T], W, 0)
                    }
                    continue
                }
                // as faces da parede que dão para o que não é parede
                const lados = [[1, 0], [-1, 0], [0, 1], [0, -1]]
                for (const [dx, dz] of lados) {
                    const nx = x + dx, nz = z + dz
                    if (!mapa.dentro(nx, nz)) continue
                    const vc = mapa.letra[mapa.idx(nx, nz)]
                    if (cheio(vc)) continue
                    let p0, du
                    if (dx === 1) { p0 = [x0 + T, 0, z0 + T]; du = [0, 0, -T] }
                    else if (dx === -1) { p0 = [x0, 0, z0]; du = [0, 0, T] }
                    else if (dz === 1) { p0 = [x0, 0, z0 + T]; du = [T, 0, 0] }
                    else { p0 = [x0 + T, 0, z0]; du = [-T, 0, 0] }
                    const nvv = Math.ceil(teto)
                    quadSub(grupos.parede, p0, du, [0, teto, 0], 2, nvv, [dx, 0, dz],
                            (p) => [(p[0] + p[2]) / T, p[1] / T], W, 0)
                    // rodapé e friso de cima
                    const base = new PZ.Geo()
                    const ax = Math.min(p0[0], p0[0] + du[0]), bx = Math.max(p0[0], p0[0] + du[0])
                    const az = Math.min(p0[2], p0[2] + du[2]), bz = Math.max(p0[2], p0[2] + du[2])
                    const fx0 = dx === 1 ? ax : dx === -1 ? ax - 0.06 : ax, fx1 = dx === 1 ? ax + 0.06 : dx === -1 ? ax : bx
                    const fz0 = dz === 1 ? az : dz === -1 ? az - 0.06 : az, fz1 = dz === 1 ? az + 0.06 : dz === -1 ? az : bz
                    const corRod = { lab: "#596074", fabrica: "#2e2824", nucleo: "#140f1a", estufa: "#2c3a2a", gelo: "#6d7c90" }[nivel.tema] || "#596074"
                    base.caixa(fx0, 0, fz0, fx1, 0.28, fz1, corRod)
                    base.caixa(fx0, teto - 0.22, fz0, fx1, teto, fz1, corRod)
                    if (nivel.tema !== "fabrica") {
                        const lc = (Mod.CORES_TEMA[nivel.tema] || Mod.CORES_TEMA.lab)[2]
                        const gx0 = dx ? fx0 - dx * 0.0 : fx0, gx1 = dx ? fx1 + dx * 0.01 : fx1
                        const gz0 = dz ? fz0 : fz0, gz1 = dz ? fz1 + dz * 0.01 : fz1
                        base.caixa(gx0, 0.28, gz0, gx1, 0.33, gz1, lc, 1.2)
                    }
                    this.assarGeo(grupos.branco, base, null, luzEm)
                }
            }

        // os objetos
        const rot = (o, geo) => {
            const d = o.dir || [0, -1]
            const th = Math.atan2(-d[0], -d[1])
            return PZ.cadeia(M4.trans(o.x * T + 1, 0, o.z * T + 1), M4.ry(th), M4.trans(-1, 0, -1))
        }
        for (const o of mapa.objetos) {
            const base = M4.trans(o.x * T, 0, o.z * T)
            if (o.tipo === "caixotes") this.assarGeo(grupos.branco, Mod.caixotes(o.x * 31 + o.z * 7), base, luzEm)
            else if (o.tipo === "bancada") this.assarGeo(grupos.branco, Mod.bancada(), base, luzEm)
            else if (o.tipo === "coluna") this.assarGeo(grupos.branco, Mod.coluna(teto, nivel.tema), base, luzEm)
            else if (o.tipo === "nucleo") this.assarGeo(grupos.branco, Mod.nucleo(teto), base, luzEm)
            else if (o.tipo === "planta") this.assarGeo(grupos.branco, Mod.planta(o.x * 17 + o.z * 5), base, luzEm)
            else if (o.tipo === "capsula") this.assarGeo(grupos.branco, Mod.capsula(teto), base, luzEm)
            else if (o.tipo === "caixa") { this.assarGeo(grupos.branco, Mod.caixaGlitch(), rot(o), luzEm); o.matriz = rot(o) }
            else if (o.tipo === "forja") { this.assarGeo(grupos.branco, Mod.forja(), rot(o), luzEm); o.matriz = rot(o) }
            else if (o.tipo === "modulo") this.assarGeo(grupos.branco, Mod.modulo(o.letra), rot(o), luzEm)
            else if (o.tipo === "parede") {
                const th = Math.atan2(o.dir[0], o.dir[1])
                const m = PZ.cadeia(M4.trans(o.px, 1.55, o.pz), M4.ry(th))
                this.assarGeo(grupos.branco, Mod.moldura("#62f3ff"), m, luzEm)
            }
        }
        for (let z = 0; z < mapa.h; z++)
            for (let x = 0; x < mapa.w; x++) {
                const c = mapa.letra[mapa.idx(x, z)]
                const cx = (x + 0.5) * T, cz = (z + 0.5) * T
                if (c === "L") this.assarGeo(grupos.branco, Mod.luminaria(rgbHex(nivel.lampada)), M4.trans(cx, teto, cz), luzEm)
                if (c === "s") this.assarGeo(grupos.branco, Mod.portal(rgbHex(nivel.portal)), M4.trans(cx, 0, cz), luzEm)
            }

        const mk = (arr, t) => {
            const d = new Float32Array(arr)
            const buf = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, buf)
            gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW)
            this.estatico.push({ buf: buf, n: d.length / NV, tex: t, emisTex: t === this.branco ? 0 : 1.6 })
        }
        mk(grupos.piso, tPiso)
        mk(grupos.parede, tParede)
        mk(grupos.teto, tTeto)
        mk(grupos.branco, this.branco)

        // as folhas das portas, uma por ladrilho, e de que lado elas correm
        this.folhas = []
        for (const p of mapa.portas)
            for (const i of p.ladrilhos) {
                const x = i % mapa.w, z = Math.floor(i / mapa.w)
                const aoLongoX = !parede(mapa.letra[mapa.idx(x - 1, z)]) && !parede(mapa.letra[mapa.idx(x + 1, z)])
                this.folhas.push({ porta: p, x: (x + 0.5) * T, z: (z + 0.5) * T, giro: aoLongoX ? Math.PI / 2 : 0 })
            }
        this.geoPorta = Mod.porta(teto, T)
        this.fx.limpar()
    }

    /** Põe a geometria com a luz assada em cada vértice. */
    assarGeo(arr, g, m, luzEm) {
        const d = g.d
        for (let i = 0; i < d.length; i += 12) {
            let x = d[i], y = d[i + 1], z = d[i + 2], nx = d[i + 3], ny = d[i + 4], nz = d[i + 5]
            if (m) {
                const px = m[0] * x + m[4] * y + m[8] * z + m[12], py = m[1] * x + m[5] * y + m[9] * z + m[13], pz = m[2] * x + m[6] * y + m[10] * z + m[14]
                const qx = m[0] * nx + m[4] * ny + m[8] * nz, qy = m[1] * nx + m[5] * ny + m[9] * nz, qz = m[2] * nx + m[6] * ny + m[10] * nz
                x = px; y = py; z = pz
                const l = Math.hypot(qx, qy, qz) || 1
                nx = Math.round(qx / l * 1000) / 1000; ny = Math.round(qy / l * 1000) / 1000; nz = Math.round(qz / l * 1000) / 1000
            }
            const l = luzEm(x, y, z, nx, ny, nz)
            arr.push(x, y, z, nx, ny, nz, d[i + 6], d[i + 7], d[i + 8], d[i + 9], d[i + 10], l[0], l[1], l[2], d[i + 11])
        }
    }

    /** A luz num ponto do mundo, para o que se mexe: ambiente + a luminária mais forte como direção. */
    luzEntidade(x, y, z, mapa) {
        const nv = this.nivel
        const amb = [nv.ambiente[0] * 1.15, nv.ambiente[1] * 1.15, nv.ambiente[2] * 1.15]
        let best = null, bf = 0
        const cor = [0, 0, 0]
        for (const L of mapa.luzes) {
            const dx = L.x - x, dy = L.y - y, dz = L.z - z, d = Math.hypot(dx, dy, dz)
            if (d > L.raio) continue
            const a = Math.pow(1 - d / L.raio, 2) * L.forca
            if (a < 0.02) continue
            if (!this.luzMapa.visivel(L.x, L.y, L.z, x, y, z)) continue
            amb[0] += L.cor[0] * a * 0.35; amb[1] += L.cor[1] * a * 0.35; amb[2] += L.cor[2] * a * 0.35
            cor[0] += L.cor[0] * a * 0.75; cor[1] += L.cor[1] * a * 0.75; cor[2] += L.cor[2] * a * 0.75
            if (a > bf) { bf = a; best = [dx / d, dy / d, dz / d] }
        }
        return { amb: amb, cor: cor, dir: best || [0, 1, 0] }
    }

    // -------------------------------------------------------------- brilhos

    sprite(p, tam, cel, c, rot) {
        if (this.sprN >= 5900) return
        const cam = this.camD, up = this.camC
        const ca = Math.cos(rot || 0), sa = Math.sin(rot || 0)
        const rx = (cam[0] * ca + up[0] * sa) * tam, ry = (cam[1] * ca + up[1] * sa) * tam, rz = (cam[2] * ca + up[2] * sa) * tam
        const ux = (up[0] * ca - cam[0] * sa) * tam, uy = (up[1] * ca - cam[1] * sa) * tam, uz = (up[2] * ca - cam[2] * sa) * tam
        this.quadSpr([p[0] - rx - ux, p[1] - ry - uy, p[2] - rz - uz], [p[0] + rx - ux, p[1] + ry - uy, p[2] + rz - uz],
                     [p[0] + rx + ux, p[1] + ry + uy, p[2] + rz + uz], [p[0] - rx + ux, p[1] - ry + uy, p[2] - rz + uz], cel, c)
    }

    /** Um feixe de a até b, virado para a câmera. */
    feixe(a, b, larg, cel, c) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
        const o = this.camO
        const vx = a[0] - o[0], vy = a[1] - o[1], vz = a[2] - o[2]
        let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx
        const l = Math.hypot(sx, sy, sz) || 1
        sx = sx / l * larg; sy = sy / l * larg; sz = sz / l * larg
        this.quadSpr([a[0] - sx, a[1] - sy, a[2] - sz], [b[0] - sx, b[1] - sy, b[2] - sz],
                     [b[0] + sx, b[1] + sy, b[2] + sz], [a[0] + sx, a[1] + sy, a[2] + sz], cel, c, true)
    }

    /** Um quadrado deitado no chão (sombra, onda de choque). */
    noChao(x, y, z, r, cel, c) {
        this.quadSpr([x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r], cel, c)
    }

    quadSpr(p0, p1, p2, p3, cel, c, feixe) {
        const u0 = (cel % 8) / 8 + 0.002, v0 = Math.floor(cel / 8) / 8 + 0.002, s = 0.125 - 0.004
        const d = this.sprD
        let k = this.sprN * 54
        const uv = feixe ? [[u0, v0 + s / 2], [u0 + s, v0 + s / 2], [u0 + s, v0 + s / 2], [u0, v0 + s / 2]]
                         : [[u0, v0 + s], [u0 + s, v0 + s], [u0 + s, v0], [u0, v0]]
        if (feixe) { uv[0] = [u0 + s / 2, v0]; uv[1] = [u0 + s / 2, v0]; uv[2] = [u0 + s / 2, v0 + s]; uv[3] = [u0 + s / 2, v0 + s] }
        const P = [p0, p1, p2, p3]
        for (const i of [0, 1, 2, 0, 2, 3]) {
            d[k] = P[i][0]; d[k + 1] = P[i][1]; d[k + 2] = P[i][2]
            d[k + 3] = uv[i][0]; d[k + 4] = uv[i][1]
            d[k + 5] = c[0]; d[k + 6] = c[1]; d[k + 7] = c[2]; d[k + 8] = c[3]
            k += 9
        }
        this.sprN++
    }

    // -------------------------------------------------------------- o quadro

    /**
     * Desenha um quadro. `cena`:
     *   cam {olho, yaw, pitch, fov}, jogo (o núcleo), t, lanterna,
     *   vm [{geo, m}] (a mão, em espaço de câmera), luzesExtras, saturacao
     */
    quadro(cena) {
        const gl = this.gl, jogo = cena.jogo, mapa = jogo.mapa, nv = this.nivel, t = cena.t
        const cam = cena.cam
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
        const f = [sy * cp, sp, -cy * cp]
        const d = [cy, 0, sy]
        const c = [d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], d[0] * f[1] - d[1] * f[0]]
        const cl = Math.hypot(c[0], c[1], c[2]); c[0] /= cl; c[1] /= cl; c[2] /= cl
        this.camO = cam.olho; this.camD = d; this.camC = c; this.camF = f
        const asp = this.w / this.h
        const proj = M4.perspectiva(cam.fov, asp, 0.05, 200)
        const vista = M4.vista(cam.olho, d, c, f)
        const vp = M4.mul(proj, vista)

        // ---------------- o que se mexe
        const L = this.lote
        L.n = 0
        const luzCache = new Map()
        const luzDe = (x, y, z) => {
            const k = ((x * 2) | 0) + "," + ((z * 2) | 0) + "," + ((y * 2) | 0)
            let v = luzCache.get(k)
            if (!v) { v = this.luzEntidade(x, y, z, mapa); luzCache.set(k, v) }
            return v
        }
        for (const e of jogo.monstros) {
            const dx = e.x - cam.olho[0], dz = e.z - cam.olho[2]
            if (dx * f[0] + dz * f[2] < -3 && dx * dx + dz * dz > 16) continue
            // congelado: para no lugar, azulado; lento: um pouco azul; portador: dourado; pegando fogo: laranja
            const gelo = !e.morto && ((jogo.ativos.congelar > 0 && !e.def.chefe) || e.congelado > 0)
            const { mod, m } = Mod.matrizes(e, gelo ? e.semente * 10 : t + e.semente * 10)
            e.mats = m
            const luz = luzDe(e.x, e.y + 1.2, e.z)
            let tom = gelo ? [0.55, 0.85, 1.35] : e.portador && !e.morto ? [1.3, 1.08, 0.55] : null
            if (!tom && e.lento > 0 && !e.morto) tom = [0.8, 0.95, 1.2]
            let emis = gelo ? 0.14 : e.portador && !e.morto ? 0.08 + 0.06 * Math.sin(t * 5) : 0
            if (e.queima > 0 && !e.morto) { emis += 0.12 + 0.08 * Math.sin(t * 23 + e.semente * 9); tom = [1.35, 0.85, 0.6] }
            if (e.estado === "morrendo") emis = Math.max(0, 1 - e.tm) * (Math.sin(t * 50 + e.semente * 9) > 0 ? 0.6 : 0)
            if (e.tipo === "bomba" && e.estado === "pavio") emis = (Math.sin(t * 30) > 0 ? 1.4 : 0.2)
            if (jogo.ativos.critico > 0 && !e.def.grande) emis += 0.12
            for (const p of mod.partes) {
                if ((p.nome === "cabeca" || p.nome === "mandibula") && e.semCabeca) continue
                L.geo(p.geo, m[p.nome], luz, e.flash * 1.8, emis, tom)
            }
        }
        // as portas
        for (const fo of this.folhas) {
            const ab = fo.porta.abre
            if (ab >= 1) continue
            const m = PZ.cadeia(M4.trans(fo.x, ab * mapa.teto, fo.z), M4.ry(fo.giro))
            L.geo(this.geoPorta, m, luzDe(fo.x, 1.5, fo.z))
        }
        // a tampa da caixa e as armas que giram em cima dela
        const caixaObj = mapa.objetos.find((o) => o.tipo === "caixa")
        if (caixaObj && caixaObj.matriz) {
            const cx = jogo.caixa
            let ab = 0
            if (cx.estado === "girando") ab = Math.min(1, cx.t / 0.4)
            else if (cx.estado === "pronta") ab = 1
            else if (cx.estado === "fechando") ab = 1 - Math.min(1, cx.t / 0.6)
            const m = PZ.cadeia(caixaObj.matriz, M4.trans(1, 0.8, 1.45), M4.rx(-ab * 1.9), M4.trans(0, 0, -0.45))
            L.geo(Mod.tampa(), m, luzDe(caixaObj.cx, 1, caixaObj.cz))
            if (cx.estado === "girando" || cx.estado === "pronta") {
                let id = cx.arma
                if (cx.estado === "girando" && cx.t < 2.8) {
                    const ids = Object.keys(PZ.ARMAS).filter((k) => k !== "faisca")
                    id = ids[Math.floor(cx.t * (8 - cx.t * 2)) % ids.length]
                }
                const sobe = cx.estado === "girando" ? Math.min(1, cx.t / 1.2) : 1
                const ar = Mod.arma(id, 1)
                const mm = PZ.cadeia(caixaObj.matriz, M4.trans(1, 0.9 + sobe * 0.6, 1.0), M4.ry(t * 1.5), M4.esc(1.6))
                L.geo(ar.geo, mm, { amb: [0.2, 0.5, 0.6], cor: [0, 0, 0], dir: [0, 1, 0] }, 0, 0.6)
            }
        }
        // as armas de parede: o holograma girando na frente da moldura
        for (const o of mapa.objetos) {
            if (o.tipo !== "parede") continue
            const dx = o.px - cam.olho[0], dz = o.pz - cam.olho[2]
            if (dx * dx + dz * dz > 900) continue
            const ar = Mod.arma(o.arma, 1)
            const m = PZ.cadeia(M4.trans(o.px + o.dir[0] * 0.2, 1.55, o.pz + o.dir[1] * 0.2),
                                M4.ry(Math.atan2(o.dir[0], o.dir[1]) + Math.PI / 2 + Math.sin(t * 0.8) * 0.3), M4.esc(1.4))
            L.geo(ar.geo, m, { amb: [0.15, 0.45, 0.55], cor: [0, 0, 0], dir: [0, 1, 0] }, 0, 0.5)
        }
        // os robozinhos escondidos: boiando baixinho e girando devagar (a pelúcia fica sentada)
        for (const o of mapa.objetos) {
            if (o.tipo !== "robozinho" || o.achado) continue
            const dx = o.cx - cam.olho[0], dz = o.cz - cam.olho[2]
            if (dx * dx + dz * dz > 1600) continue
            if (o.pelucia) {
                const g = this.geoPelucia || (this.geoPelucia = Mod.pelucia())
                L.geo(g, PZ.cadeia(M4.trans(o.cx, o.base, o.cz), M4.ry(2.4)), luzDe(o.cx, o.base + 0.4, o.cz), 0, 0.05)
            } else {
                const geo = this.geoDrone || (this.geoDrone = Mod.drone())
                const y = o.base + 0.32 + Math.sin(t * 2 + o.x) * 0.05
                L.geo(geo, PZ.cadeia(M4.trans(o.cx, y, o.cz), M4.ry(t * 0.6 + o.z), M4.esc(0.55)), luzDe(o.cx, y, o.cz), 0, 0.05)
            }
        }
        // o robozinho aliado: olha para o alvo (ou para onde ela olha)
        if (jogo.drone) {
            const d = jogo.drone
            const yaw = d.alvo && !d.alvo.morto ? Math.atan2(d.alvo.x - d.x, -(d.alvo.z - d.z)) : jogo.jog.yaw
            const geo = this.geoDrone || (this.geoDrone = Mod.drone())
            L.geo(geo, PZ.cadeia(M4.trans(d.x, d.y, d.z), M4.ry(-yaw), M4.rz(Math.sin(t * 3) * 0.1), M4.esc(0.8)), luzDe(d.x, d.y, d.z), 0, 0.1)
        }
        // granadas, foguetes e as pedras do Urso
        for (const p of jogo.projeteis) {
            if (p.tipo === "pedra") {
                const g = this.geoPedra || (this.geoPedra = Mod.pedra())
                L.geo(g, PZ.cadeia(M4.trans(p.x, p.y, p.z), M4.rx(p.girar), M4.ry(p.girar * 0.6)), luzDe(p.x, p.y, p.z), 0, 0.3)
            }
            if (p.tipo === "granada") {
                const g = this.geoGranada || (this.geoGranada = new PZ.Geo().esfera(0, 0, 0, 0.08, 0.08, 0.08, "#2c303c", 0, 8).caixa(-0.02, 0.06, -0.02, 0.02, 0.1, 0.02, "#62f3ff", 2))
                L.geo(g, PZ.cadeia(M4.trans(p.x, p.y, p.z), M4.rx(p.girar)), luzDe(p.x, p.y, p.z), 0, Math.sin(t * 20) > 0 ? 0.8 : 0)
            }
        }
        // os cubinhos do glitch (pedaços que voam)
        const cubo = this.geoCubo || (this.geoCubo = new PZ.Geo().caixa(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, "#ffffff"))
        for (const q of this.fx.cubos) {
            const m = PZ.cadeia(M4.trans(q.p[0], q.p[1], q.p[2]), M4.rx(q.r), M4.ry(q.r * 0.7), M4.esc(q.tam))
            L.geo(cubo, m, luzDe(q.p[0], q.p[1], q.p[2]), 0, q.emis, q.cor)
        }

        // ---------------- a mão (viseira): no mundo, a partir da câmera
        const VM = this.loteVM
        VM.n = 0
        if (cena.vm && cena.vm.length) {
            const cm = M4.mundoDaCamera(cam.olho, d, c, f)
            const luz = luzDe(cam.olho[0], cam.olho[1], cam.olho[2])
            const luzVM = { amb: [luz.amb[0] + 0.12, luz.amb[1] + 0.12, luz.amb[2] + 0.14], cor: luz.cor, dir: luz.dir }
            for (const item of cena.vm) VM.geo(item.geo, M4.mul(cm, item.m), luzVM, item.flash || 0, item.emis || 0)
        }

        // ---------------- as luzes que piscam
        const dyn = (cena.luzesExtras || []).concat(this.fx.luzes)
        for (const p of jogo.projeteis) {
            if (p.tipo === "cuspe") dyn.push({ p: [p.x, p.y, p.z], cor: [0.3, 1.2, 0.5], raio: 5 })
            else if (p.tipo === "orbe") dyn.push({ p: [p.x, p.y, p.z], cor: [1.2, 0.3, 1.3], raio: 7 })
            else if (p.tipo === "foguete") dyn.push({ p: [p.x, p.y, p.z], cor: [1.5, 0.8, 0.3], raio: 7 })
            else if (p.tipo === "acido") dyn.push({ p: [p.x, p.y, p.z], cor: [0.6, 1.4, 0.3], raio: 6 })
            else if (p.tipo === "pedra") dyn.push({ p: [p.x, p.y, p.z], cor: [0.5, 0.9, 1.4], raio: 6 })
        }
        if (jogo.drone) dyn.push({ p: [jogo.drone.x, jogo.drone.y - 0.2, jogo.drone.z], cor: [0.8, 0.35, 1.3], raio: 4 })
        for (const p of jogo.projeteis) if (p.tipo === "coracao") dyn.push({ p: [p.x, p.y, p.z], cor: [1.6, 0.4, 1.1], raio: 6 })
        // a festa dos robozinhos: luzes coloridas girando em volta da Protogen, como numa pista de dança
        if (jogo.festa > 0) {
            const j = jogo.jog, k = Math.min(1, jogo.festa / 1.5)
            for (let i = 0; i < 3; i++) {
                const a = t * 1.7 + i * Math.PI * 2 / 3, h = (t * 0.25 + i / 3) % 1
                const c = hsv(h).map((v) => v * 2.4 * k)
                dyn.push({ p: [j.x + Math.cos(a) * 5, mapa.teto - 0.4, j.z + Math.sin(a) * 5], cor: c, raio: 12 })
            }
        }
        for (const pc of jogo.pocas) dyn.push({ p: [pc.x, 0.4, pc.z], cor: [0.35, 0.9, 0.15], raio: 4 })
        for (const pw of jogo.poderes) dyn.push({ p: [pw.x, 1, pw.z], cor: [0.3, 1.0, 0.5], raio: 5 })
        // o chefe ilumina em volta dele (cada um na sua cor)
        if (jogo.chefe && !jogo.chefe.morto) {
            const e = jogo.chefe, fx = Math.sin(e.ang), fz = -Math.cos(e.ang)
            dyn.push({ p: [e.x + fx * 1.2, e.y + e.def.altura * 0.66, e.z + fz * 1.2], cor: e.def.cor || [1.6, 0.5, 2.0], raio: 9 })
        }
        if (jogo.forjaT > 0) {
            const fo = mapa.objetos.find((o) => o.tipo === "forja")
            if (fo) dyn.push({ p: [fo.cx, 1.6, fo.cz], cor: [2.5, 1.0, 0.2], raio: 8 })
        }
        const o = cam.olho
        dyn.sort((a, b) => {
            const da = Math.hypot(a.p[0] - o[0], a.p[1] - o[1], a.p[2] - o[2]) / a.raio
            const db = Math.hypot(b.p[0] - o[0], b.p[1] - o[1], b.p[2] - o[2]) / b.raio
            return da - db
        })
        const lp = new Float32Array(MAX_LUZES * 4), lc = new Float32Array(MAX_LUZES * 3)
        for (let i = 0; i < Math.min(MAX_LUZES, dyn.length); i++) {
            const q = dyn[i]
            lp.set([q.p[0], q.p[1], q.p[2], q.raio], i * 4)
            lc.set(q.cor, i * 3)
        }

        // ---------------- desenha
        gl.viewport(0, 0, this.w, this.h)
        gl.clearColor(nv.neblina[0], nv.neblina[1], nv.neblina[2], 1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.enable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)
        gl.disable(gl.BLEND)
        gl.depthMask(true)
        const P = this.prog
        gl.useProgram(P.p)
        gl.uniformMatrix4fv(P.u.u_vp, false, vp)
        gl.uniform3fv(P.u.u_cam, o)
        gl.uniform3fv(P.u.u_neblina, nv.neblina)
        gl.uniform1f(P.u.u_dens, nv.densidade)
        gl.uniform4fv(P.u.u_luzP, lp)
        gl.uniform3fv(P.u.u_luzC, lc)
        gl.uniform3fv(P.u.u_lanP, [o[0] + d[0] * 0.25, o[1] - 0.1, o[2] + d[2] * 0.25])
        gl.uniform3fv(P.u.u_lanD, f)
        gl.uniform1f(P.u.u_lan, cena.lanterna ? 1 : 0)
        gl.uniform1f(P.u.u_sat, cena.saturacao === undefined ? 1 : cena.saturacao)
        gl.uniform1i(P.u.u_tex, 0)
        gl.activeTexture(gl.TEXTURE0)
        const pulso = 1.3 + Math.sin(t * 2.2) * 0.35
        for (const e of this.estatico) {
            gl.bindTexture(gl.TEXTURE_2D, e.tex)
            gl.uniform1f(P.u.u_emisTex, e.emisTex * pulso)
            this.desenharBuf(e.buf, e.n)
        }
        gl.bindTexture(gl.TEXTURE_2D, this.branco)
        gl.uniform1f(P.u.u_emisTex, 0)
        L.enviar()
        this.desenharBuf(L.buf, L.n)

        // ---------------- brilhos e partículas
        this.sprN = 0
        this.montarBrilhos(jogo, t)
        this.desenharSprites(vp)

        // ---------------- a mão, por cima de tudo
        if (VM.n) {
            gl.clear(gl.DEPTH_BUFFER_BIT)
            gl.useProgram(P.p)
            const projVM = M4.perspectiva(cena.fovVM || 1.0, asp, 0.01, 10)
            gl.uniformMatrix4fv(P.u.u_vp, false, M4.mul(projVM, vista))
            gl.bindTexture(gl.TEXTURE_2D, this.branco)
            gl.uniform1f(P.u.u_emisTex, 0)
            gl.uniform1f(P.u.u_dens, 0)
            VM.enviar()
            this.desenharBuf(VM.buf, VM.n)
            // o clarão do cano, por cima da arma
            if (cena.clarao) {
                this.sprN = 0
                const b = cena.clarao
                const pm = M4.ponto(M4.mundoDaCamera(cam.olho, d, c, f), b.p[0], b.p[1], b.p[2])
                this.sprite(pm, b.tam, 9, b.cor, b.rot)
                this.sprite(pm, b.tam * 2.2, 0, [b.cor[0] * 0.5, b.cor[1] * 0.5, b.cor[2] * 0.5, 0.5])
                this.desenharSprites(M4.mul(projVM, vista), true)
            }
        }
    }

    desenharBuf(buf, n) {
        if (!n) return
        const gl = this.gl, a = this.prog.a
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        const s = NV * 4
        const at = (nome, tam, off) => {
            const loc = a[nome]
            if (loc === undefined || loc < 0) return
            gl.enableVertexAttribArray(loc)
            gl.vertexAttribPointer(loc, tam, gl.FLOAT, false, s, off * 4)
        }
        at("a_pos", 3, 0); at("a_nrm", 3, 3); at("a_uv", 2, 6); at("a_cor", 3, 8); at("a_luz", 3, 11); at("a_emis", 1, 14)
        gl.drawArrays(gl.TRIANGLES, 0, n)
    }

    /** Monta os brilhos do quadro: sombras primeiro (normais), o resto somado. */
    montarBrilhos(jogo, t) {
        const nv = this.nivel
        this.sprSombra = 0
        // sombras no chão (mistura normal) — vão primeiro e contam à parte
        for (const e of jogo.monstros) {
            if (e.y < -0.5) continue
            const k = e.estado === "morrendo" ? Math.max(0, 1 - e.tm / 2) : 1
            this.noChao(e.x, 0.02, e.z, e.def.raio * 1.6, 8, [1, 1, 1, 0.8 * k])
        }
        for (const pw of jogo.poderes) this.noChao(pw.x, 0.02, pw.z, 0.6, 8, [1, 1, 1, 0.6])
        this.sprSombra = this.sprN

        // luminárias e portais
        const lam = nv.lampada
        for (const L of jogo.mapa.luzes) {
            const dx = L.x - this.camO[0], dz = L.z - this.camO[2]
            if (dx * dx + dz * dz > 2500) continue
            if (L.y > 2.5) this.sprite([L.x, L.y - 0.2, L.z], 0.9, 0, [lam[0] * 0.25, lam[1] * 0.25, lam[2] * 0.25, 1])
        }
        for (const p of jogo.mapa.portais) {
            const k = 0.5 + 0.5 * Math.sin(t * 3 + p.x)
            const pc = nv.portal
            this.noChao(p.cx, 0.03, p.cz, 1.0 + k * 0.15, 2, [pc[0] * 0.35 * (0.6 + k * 0.4), pc[1] * 0.35, pc[2] * 0.35, 1])
        }
        // os olhos dos monstros brilham (os pontos vêm do modelo, já na pose)
        for (const e of jogo.monstros) {
            if (e.morto || e.semCabeca || e.y < -0.6 || !e.mats) continue
            const mod = Mod.modelo(e.tipo, e.variante)
            const cc = PZ.cor(mod.cores.olho)
            const tam = e.def.cabeca.r * 0.45 * (e.esc || 1) * (PZ.segredos.cabecudo ? 1.9 : 1)
            const apaixonado = e.coracao > 0
            for (const o of mod.olhos) {
                const q = M4.ponto(e.mats.cabeca, o[0], o[1], o[2])
                if (apaixonado) this.sprite(q, tam * 0.9, 22, [1.2, 0.35, 0.8, 1])
                else this.sprite(q, tam, 0, [cc[0] * 0.35, cc[1] * 0.35, cc[2] * 0.35, 1])
            }
            // os coraçõezinhos rodando em cima da cabeça de quem levou boop
            if (apaixonado) for (let i = 0; i < 3; i++) {
                const a = t * 3 + i * 2.1, h = e.y + e.def.altura * (PZ.segredos.cabecudo ? 1.25 : 1.05)
                this.sprite([e.x + Math.cos(a) * 0.3, h + Math.sin(t * 4 + i) * 0.05, e.z + Math.sin(a) * 0.3], 0.1, 22, [1.1, 0.3, 0.7, 1])
            }
        }
        // quem pega fogo solta chamas; o Urso soprando solta o hálito de gelo
        for (const e of jogo.monstros) {
            if (e.morto || e.y < -0.6) continue
            if (e.queima > 0 && Math.random() < 0.6) {
                const r = e.def.raio
                this.fx.chama([e.x + (Math.random() - 0.5) * r * 1.4, e.y + Math.random() * e.def.altura * 0.85, e.z + (Math.random() - 0.5) * r * 1.4])
            }
            if (e.tipo === "urso" && e.estado === "soprando" && e.tm > 0.7 && e.mats) {
                const boca = M4.ponto(e.mats.mandibula, 0, (1.42 + 0.05 * 1.15) * 2.3, -0.33 * 1.15 * 2.3)
                const fx = Math.sin(e.ang), fz = -Math.cos(e.ang)
                for (let i = 0; i < 3; i++) this.fx.sopro(boca, [fx, -0.12, fz])
            }
        }
        // as poças de ácido no chão
        for (const pc of jogo.pocas) {
            const k = Math.min(1, pc.t / 0.3) * Math.min(1, (pc.dura - pc.t) / 1.2)
            this.noChao(pc.x, 0.035, pc.z, pc.r, 0, [0.22 * k, 0.6 * k, 0.08 * k, 1])
            this.noChao(pc.x, 0.04, pc.z, pc.r * 0.7, 3, [0.15 * k, 0.4 * k, 0.05 * k, 1])
            if (Math.random() < 0.08) this.fx.bolha([pc.x + (Math.random() - 0.5) * pc.r * 1.2, 0.05, pc.z + (Math.random() - 0.5) * pc.r * 1.2])
        }
        for (const o of jogo.mapa.objetos) {
            if (o.tipo !== "robozinho" || o.achado || o.pelucia) continue
            const y = o.base + 0.32 + Math.sin(t * 2 + o.x) * 0.05
            this.sprite([o.cx, y - 0.13, o.cz], 0.09, 0, [0.6, 0.25, 0.9, 1])
        }
        // a festa: brilhinhos coloridos em cima de quem dança
        if (jogo.festa > 0) for (const e of jogo.monstros) {
            if (e.morto || !(e.dancando > 0) || Math.random() > 0.08) continue
            const c = hsv(Math.random())
            this.fx.brilho([e.x + (Math.random() - 0.5), e.y + e.def.altura + 0.2, e.z + (Math.random() - 0.5)], 0.18, c, 0.5, 1)
        }
        // o robozinho: o propulsor aceso
        if (jogo.drone) {
            const d = jogo.drone
            this.sprite([d.x, d.y - 0.22, d.z], 0.16, 0, [0.8, 0.35, 1.2, 1])
            this.sprite([d.x, d.y, d.z], 0.4, 0, [0.15, 0.08, 0.25, 1])
        }
        // poderes: o ícone girando, com um anel
        for (const pw of jogo.poderes) {
            const pisca = pw.t > 21 ? (Math.sin(pw.t * 14) > 0 ? 1 : 0.15) : 1
            const cel = ICONE_PODER[pw.tipo] || 4
            const c = COR_PODER[pw.tipo] || [0.35, 1, 0.55]
            const y = 1.05 + Math.sin(t * 2.5 + pw.x) * 0.12
            this.sprite([pw.x, y, pw.z], 0.55, cel, [c[0] * pisca, c[1] * pisca, c[2] * pisca, 1])
            this.sprite([pw.x, y, pw.z], 1.0, 0, [c[0] * 0.3 * pisca, c[1] * 0.3 * pisca, c[2] * 0.3 * pisca, 1])
            this.noChao(pw.x, 0.04, pw.z, 0.8, 2, [c[0] * 0.45 * pisca, c[1] * 0.45 * pisca, c[2] * 0.45 * pisca, 1])
        }
        // os portadores: um halo dourado que pulsa no peito
        for (const e of jogo.monstros) {
            if (!e.portador || e.morto || e.y < -1) continue
            const k = 0.6 + 0.4 * Math.sin(t * 5 + e.semente * 9)
            this.sprite([e.x, e.y + e.def.altura * 0.6, e.z], 0.9 + 0.2 * k, 0, [0.5 * k, 0.4 * k, 0.08 * k, 1])
            if (Math.random() < 0.15) this.fx.brilho([e.x + (Math.random() - 0.5) * 0.6, e.y + 0.4 + Math.random() * 1.4, e.z + (Math.random() - 0.5) * 0.6], 0.1, [1, 0.8, 0.25], 0.5, 1)
        }
        // projéteis
        for (const p of jogo.projeteis) {
            if (p.tipo === "cuspe") { this.sprite([p.x, p.y, p.z], 0.35, 0, [0.4, 1, 0.5, 1]); this.sprite([p.x, p.y, p.z], 0.18, 1, [1, 1, 1, 1], t * 9) }
            else if (p.tipo === "orbe") { this.sprite([p.x, p.y, p.z], 0.6, 0, [1, 0.35, 1, 1]); this.sprite([p.x, p.y, p.z], 0.3, 1, [1, 1, 1, 1], t * 7) }
            else if (p.tipo === "foguete") { this.sprite([p.x, p.y, p.z], 0.5, 0, [1, 0.7, 0.3, 1]); this.sprite([p.x, p.y, p.z], 0.25, 1, [1, 1, 0.9, 1], t * 11) }
            else if (p.tipo === "granada") this.sprite([p.x, p.y + 0.08, p.z], 0.18, 0, [0.3, 0.9, 1, Math.sin(t * 20) > 0 ? 1 : 0.2])
            else if (p.tipo === "acido") { this.sprite([p.x, p.y, p.z], 0.5, 0, [0.45, 1, 0.2, 1]); this.sprite([p.x, p.y, p.z], 0.22, 1, [0.9, 1, 0.6, 1], t * 6) }
            else if (p.tipo === "pedra") this.sprite([p.x, p.y, p.z], 0.9, 0, [0.15, 0.3, 0.45, 1])
            else if (p.tipo === "coracao") {
                this.sprite([p.x, p.y, p.z], 0.75, 0, [0.6, 0.12, 0.4, 1])
                this.sprite([p.x, p.y, p.z], 0.32, 22, [1.3, 0.45, 0.95, 1], Math.sin(p.girar) * 0.3)
            }
        }
        // ondas de choque do chefe
        for (const o of jogo.ondasDeChoque) {
            const c = jogo.chefe && jogo.chefe.def.cor ? jogo.chefe.def.cor : [1.6, 0.5, 2.0]
            this.noChao(o.x, 0.1, o.z, o.r, 11, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1])
        }
        // a forja trabalhando
        if (jogo.forjaT > 0) {
            const fo = jogo.mapa.objetos.find((q) => q.tipo === "forja")
            if (fo && Math.random() < 0.5) this.fx.faiscas([fo.cx + fo.dir[0] * 0.6, 1.25, fo.cz + fo.dir[1] * 0.6], 2, [1, 0.6, 0.2], 4)
        }
        this.fx.desenhar(this)
    }

    desenharSprites(vp, soSomar) {
        if (!this.sprN) return
        const gl = this.gl, S = this.spr
        gl.useProgram(S.p)
        gl.uniformMatrix4fv(S.u.u_vp, false, vp)
        gl.uniform1i(S.u.u_tex, 0)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.atlas)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sprBuf)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sprD.subarray(0, this.sprN * 54))
        const st = 9 * 4
        gl.enableVertexAttribArray(S.a.a_pos); gl.vertexAttribPointer(S.a.a_pos, 3, gl.FLOAT, false, st, 0)
        gl.enableVertexAttribArray(S.a.a_uv); gl.vertexAttribPointer(S.a.a_uv, 2, gl.FLOAT, false, st, 12)
        gl.enableVertexAttribArray(S.a.a_cor); gl.vertexAttribPointer(S.a.a_cor, 4, gl.FLOAT, false, st, 20)
        // os atributos do outro shader que não existem aqui ficam desligados
        for (const nome in this.prog.a) {
            const loc = this.prog.a[nome]
            if (loc !== S.a.a_pos && loc !== S.a.a_uv && loc !== S.a.a_cor) gl.disableVertexAttribArray(loc)
        }
        gl.enable(gl.BLEND)
        gl.depthMask(false)
        const sombra = soSomar ? 0 : (this.sprSombra || 0)
        if (sombra) {
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
            gl.drawArrays(gl.TRIANGLES, 0, sombra * 6)
        }
        gl.blendFunc(gl.ONE, gl.ONE)
        gl.drawArrays(gl.TRIANGLES, sombra * 6, (this.sprN - sombra) * 6)
        gl.depthMask(true)
        gl.disable(gl.BLEND)
        gl.disableVertexAttribArray(S.a.a_pos); gl.disableVertexAttribArray(S.a.a_uv); gl.disableVertexAttribArray(S.a.a_cor)
    }
}

const ICONE_PODER = { municao: 4, recarga: 12, critico: 5, dobro: 6, atomica: 17, escudo: 13, congelar: 14, furia: 15, bonus: 16,
                      vampiro: 18, drone: 19, patas: 20, liquidacao: 21, vida: 22, booper: 22 }
const COR_PODER = { municao: [0.35, 1, 0.55], recarga: [0.35, 0.95, 1.1], critico: [1.1, 0.3, 0.4], dobro: [1.1, 0.85, 0.25],
                    atomica: [1.2, 0.75, 0.2], escudo: [0.4, 0.6, 1.2], congelar: [0.6, 0.9, 1.2], furia: [1.1, 0.3, 1.0], bonus: [1.1, 0.95, 0.4],
                    vampiro: [1.2, 0.15, 0.3], drone: [0.85, 0.45, 1.3], patas: [0.4, 1.2, 0.9], liquidacao: [1.2, 0.6, 1.1], vida: [0.4, 1.2, 0.5], booper: [1.4, 0.45, 1.0] }

/** Uma cor viva do arco-íris (h de 0 a 1). */
function hsv(h) {
    const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)) }
    return [f(5), f(3), f(1)]
}

function rgbHex(c) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v / Math.max(c[0], c[1], c[2], 1) * 255))).toString(16).padStart(2, "0")
    return "#" + h(c[0]) + h(c[1]) + h(c[2])
}

// ------------------------------------------------------------------ efeitos (partículas)

class Efeitos {
    constructor() { this.limpar() }

    limpar() {
        this.ps = []
        this.cubos = []
        this.feixes = []
        this.luzes = []
        this.luzesT = []
    }

    luz(p, cor, raio, dura) { this.luzesT.push({ p: p, cor: cor, raio: raio, vida: dura, max: dura }) }

    faiscas(p, n, cor, vel, op) {
        op = op || {}
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, b = Math.random() * 2 - 1, v = (0.4 + Math.random()) * (vel || 5)
            const dir = op.n ? [op.n[0] + Math.cos(a) * Math.sqrt(1 - b * b) * 0.9, op.n[1] + b * 0.9, op.n[2] + Math.sin(a) * Math.sqrt(1 - b * b) * 0.9]
                             : [Math.cos(a) * Math.sqrt(1 - b * b), b, Math.sin(a) * Math.sqrt(1 - b * b)]
            this.ps.push({ p: p.slice(), v: [dir[0] * v, dir[1] * v, dir[2] * v], vida: 0.25 + Math.random() * 0.3, max: 0.55,
                           tam: op.tam || 0.06, cel: 1, cor: cor, grav: 9, estica: true })
        }
    }

    brilho(p, tam, cor, dura, cel) {
        this.ps.push({ p: p.slice(), v: [0, 0, 0], vida: dura, max: dura, tam: tam, cel: cel === undefined ? 0 : cel, cor: cor, grav: 0, cresce: true })
    }

    fumaca(p, n, cor) {
        for (let i = 0; i < n; i++)
            this.ps.push({ p: [p[0] + (Math.random() - 0.5) * 0.6, p[1] + Math.random() * 0.5, p[2] + (Math.random() - 0.5) * 0.6],
                           v: [(Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2],
                           vida: 0.9 + Math.random() * 0.8, max: 1.7, tam: 0.6 + Math.random() * 0.6, cel: 3, cor: cor || [0.2, 0.18, 0.22],
                           grav: -0.4, cresce: true, rot: Math.random() * 6 })
    }

    cubinhos(p, n, cor, vel) {
        for (let i = 0; i < n && this.cubos.length < 260; i++) {
            const a = Math.random() * Math.PI * 2, v = (0.5 + Math.random()) * (vel || 3)
            this.cubos.push({ p: [p[0] + (Math.random() - 0.5) * 0.3, p[1] + (Math.random() - 0.5) * 0.3, p[2] + (Math.random() - 0.5) * 0.3],
                              v: [Math.cos(a) * v, 1.5 + Math.random() * 3, Math.sin(a) * v], r: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
                              vida: 0.8 + Math.random() * 0.8, tam: 0.025 + Math.random() * 0.045, cor: cor, emis: Math.random() < 0.5 ? 1.5 : 0 })
        }
    }

    feixe(a, b, larg, cor, dura, cel) { this.feixes.push({ a: a, b: b, larg: larg, cor: cor, vida: dura, max: dura, cel: cel === undefined ? 0 : cel }) }

    /** Uma lambida de fogo, subindo. */
    chama(p, v, tam) {
        const q = Math.random()
        this.ps.push({ p: p.slice(), v: v ? v.slice() : [(Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4],
                       vida: 0.3 + Math.random() * 0.25, max: 0.55, tam: tam || 0.18 + Math.random() * 0.12, cel: 0,
                       cor: [1.2, 0.45 + q * 0.4, 0.12], grav: -2, cresce: true })
    }

    /** O hálito do Urso: neve que sai em cone. */
    sopro(p, d) {
        const v = 8 + Math.random() * 3
        this.ps.push({ p: p.slice(), v: [d[0] * v + (Math.random() - 0.5) * 2.5, d[1] * v + (Math.random() - 0.5) * 1.6, d[2] * v + (Math.random() - 0.5) * 2.5],
                       vida: 0.6 + Math.random() * 0.4, max: 1.0, tam: 0.25 + Math.random() * 0.35, cel: Math.random() < 0.5 ? 3 : 0,
                       cor: [0.55, 0.85, 1.1], grav: 0.5, cresce: true, rot: Math.random() * 6 })
    }

    bolha(p) {
        this.ps.push({ p: p.slice(), v: [0, 0.5 + Math.random() * 0.5, 0], vida: 0.5, max: 0.5, tam: 0.07, cel: 2, cor: [0.5, 1.1, 0.3], grav: 0, cresce: true })
    }

    /** Um raio elétrico de a até b: um zigue-zague que muda a cada quadro. */
    raio(pontos, cor, dura) { this.feixes.push({ raio: pontos, cor: cor, vida: dura, max: dura }) }

    atualizar(dt, mapa) {
        for (const p of this.ps) {
            p.vida -= dt
            p.v[1] -= p.grav * dt
            p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt
            if (p.p[1] < 0.02 && p.grav > 0) { p.p[1] = 0.02; p.v[1] *= -0.3; p.v[0] *= 0.5; p.v[2] *= 0.5 }
        }
        this.ps = this.ps.filter((p) => p.vida > 0)
        if (this.ps.length > 1500) this.ps.splice(0, this.ps.length - 1500)
        for (const q of this.cubos) {
            q.vida -= dt
            q.v[1] -= 12 * dt
            q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt
            q.r += q.vr * dt
            if (q.p[1] < q.tam / 2) { q.p[1] = q.tam / 2; q.v[1] *= -0.35; q.v[0] *= 0.6; q.v[2] *= 0.6; q.vr *= 0.6 }
            if (mapa && mapa.alt(Math.floor(q.p[0] / T), Math.floor(q.p[2] / T)) > q.p[1]) { q.v[0] *= -0.4; q.v[2] *= -0.4 }
            if (q.vida < 0.3) q.tam *= 0.9
        }
        this.cubos = this.cubos.filter((q) => q.vida > 0)
        for (const f of this.feixes) f.vida -= dt
        this.feixes = this.feixes.filter((f) => f.vida > 0)
        for (const l of this.luzesT) l.vida -= dt
        this.luzesT = this.luzesT.filter((l) => l.vida > 0)
        this.luzes = this.luzesT.map((l) => ({ p: l.p, raio: l.raio, cor: l.cor.map((v) => v * (l.vida / l.max)) }))
    }

    desenhar(R) {
        for (const p of this.ps) {
            const k = Math.max(0, p.vida / p.max)
            const tam = p.cresce ? p.tam * (1.6 - k * 0.6) : p.tam
            const a = p.cel === 3 ? k * 0.5 : k
            if (p.estica) {
                const b = [p.p[0] - p.v[0] * 0.03, p.p[1] - p.v[1] * 0.03, p.p[2] - p.v[2] * 0.03]
                R.feixe(b, p.p, tam * 0.5, 0, [p.cor[0] * a, p.cor[1] * a, p.cor[2] * a, a])
            } else R.sprite(p.p, tam, p.cel, [p.cor[0] * a, p.cor[1] * a, p.cor[2] * a, a], p.rot || 0)
        }
        for (const f of this.feixes) {
            const k = Math.max(0, f.vida / f.max)
            const c = [f.cor[0] * k, f.cor[1] * k, f.cor[2] * k, k]
            if (f.raio) {
                for (let i = 0; i + 1 < f.raio.length; i++) {
                    const a = f.raio[i], b = f.raio[i + 1]
                    let ant = a
                    const n = 7
                    for (let s = 1; s <= n; s++) {
                        const q = s / n
                        const j = s === n ? 0 : 0.35
                        const pt = [a[0] + (b[0] - a[0]) * q + (Math.random() - 0.5) * j, a[1] + (b[1] - a[1]) * q + (Math.random() - 0.5) * j,
                                    a[2] + (b[2] - a[2]) * q + (Math.random() - 0.5) * j]
                        R.feixe(ant, pt, 0.08, 0, c)
                        R.feixe(ant, pt, 0.025, 0, [k, k, k, k])
                        ant = pt
                    }
                }
            } else R.feixe(f.a, f.b, f.larg, f.cel, c)
        }
    }
}

PZ.Render = Render
PZ.Efeitos = Efeitos

})(window.PZ = window.PZ || {})
