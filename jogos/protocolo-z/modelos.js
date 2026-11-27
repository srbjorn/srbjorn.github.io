/*
 * Protocolo Z — os modelos, feitos em código: caixas, cilindros e esferas
 * com cor por vértice e um brilho (emissivo) por vértice. Low-poly com neon,
 * no jeito da viseira de LED da Protogen.
 *
 * Os monstros são bonecos de partes rígidas (quadril, tronco, cabeça, braços
 * e pernas com cotovelo e joelho), animados por `pose`: cada parte gira em
 * volta do seu pivô. Eles são protogens corrompidos — a viseira vermelha.
 *
 * O formato do vértice (12 números): x y z  nx ny nz  u v  r g b  emissivo.
 */
(function (PZ) {
"use strict"

// ------------------------------------------------------------------ matrizes
// 4 × 4 em coluna, como o WebGL quer.

const M4 = {
    id() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
    mul(a, b) {
        const o = new Float32Array(16)
        for (let c = 0; c < 4; c++)
            for (let r = 0; r < 4; r++)
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
        return o
    },
    trans(x, y, z) { const m = M4.id(); m[12] = x; m[13] = y; m[14] = z; return m },
    esc(x, y, z) { const m = M4.id(); m[0] = x; m[5] = y === undefined ? x : y; m[10] = z === undefined ? x : z; return m },
    rx(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.id(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m },
    ry(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.id(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m },
    rz(a) { const c = Math.cos(a), s = Math.sin(a), m = M4.id(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m },
    perspectiva(fovy, asp, perto, longe) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (perto - longe)
        return new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (longe + perto) * nf, -1, 0, 0, 2 * longe * perto * nf, 0])
    },
    /** A câmera: olho e os três eixos (direita, cima, frente). */
    vista(o, d, c, f) {
        return new Float32Array([d[0], c[0], -f[0], 0, d[1], c[1], -f[1], 0, d[2], c[2], -f[2], 0,
            -(d[0] * o[0] + d[1] * o[1] + d[2] * o[2]), -(c[0] * o[0] + c[1] * o[1] + c[2] * o[2]),
            (f[0] * o[0] + f[1] * o[1] + f[2] * o[2]), 1])
    },
    /** A inversa da vista: do espaço da câmera para o mundo. */
    mundoDaCamera(o, d, c, f) {
        return new Float32Array([d[0], d[1], d[2], 0, c[0], c[1], c[2], 0, -f[0], -f[1], -f[2], 0, o[0], o[1], o[2], 1])
    },
    ponto(m, x, y, z) {
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
    }
}

/** Uma pilha de matrizes encadeadas, para montar a mão sem repetir mul. */
function cadeia(...ms) {
    let m = ms[0]
    for (let i = 1; i < ms.length; i++) m = M4.mul(m, ms[i])
    return m
}

// ------------------------------------------------------------------ cores

const cache = {}
function cor(h) {
    if (Array.isArray(h)) return h
    if (cache[h]) return cache[h]
    const n = parseInt(h.slice(1), 16)
    return (cache[h] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255])
}

// ------------------------------------------------------------------ geometria

class Geo {
    constructor() { this.d = [] }
    get n() { return this.d.length / 12 }

    vert(x, y, z, nx, ny, nz, u, v, c, e) {
        this.d.push(x, y, z, nx, ny, nz, u, v, c[0], c[1], c[2], e)
    }

    /** Quadrilátero p0 p1 p2 p3 (em volta), com a normal dada ou calculada. */
    quad(p0, p1, p2, p3, c, e, n, uv) {
        c = cor(c)
        e = e || 0
        if (!n) {
            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2]
            const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2]
            n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
            const l = Math.hypot(n[0], n[1], n[2]) || 1
            n = [n[0] / l, n[1] / l, n[2] / l]
        }
        uv = uv || [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]
        const P = [p0, p1, p2, p3]
        for (const i of [0, 1, 2, 0, 2, 3]) this.vert(P[i][0], P[i][1], P[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1], c, e)
    }

    tri(p0, p1, p2, c, e) {
        c = cor(c)
        const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2]
        const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2]
        let n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
        const l = Math.hypot(n[0], n[1], n[2]) || 1
        n = [n[0] / l, n[1] / l, n[2] / l]
        for (const p of [p0, p1, p2]) this.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0.5, 0.5, c, e || 0)
    }

    /** Caixa alinhada aos eixos. `faces` pode tirar lados ("-y" etc.). */
    caixa(x0, y0, z0, x1, y1, z1, c, e, sem) {
        if (x0 > x1) { const t = x0; x0 = x1; x1 = t }
        if (y0 > y1) { const t = y0; y0 = y1; y1 = t }
        if (z0 > z1) { const t = z0; z0 = z1; z1 = t }
        sem = sem || ""
        if (!sem.includes("+y")) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], c, e, [0, 1, 0])
        if (!sem.includes("-y")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, e, [0, -1, 0])
        if (!sem.includes("+x")) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], c, e, [1, 0, 0])
        if (!sem.includes("-x")) this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], c, e, [-1, 0, 0])
        if (!sem.includes("+z")) this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], c, e, [0, 0, 1])
        if (!sem.includes("-z")) this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], c, e, [0, 0, -1])
        return this
    }

    /** Cilindro em pé (eixo y), de y0 a y1. */
    cilindro(cx, cz, y0, y1, r, seg, c, e, r1) {
        r1 = r1 === undefined ? r : r1
        seg = seg || 8
        for (let i = 0; i < seg; i++) {
            const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2
            const p = (a, rr, y) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr]
            this.quad(p(a0, r, y0), p(a1, r, y0), p(a1, r1, y1), p(a0, r1, y1), c, e, [Math.cos(am), (r - r1) / (y1 - y0), Math.sin(am)])
            this.tri(p(a0, r1, y1), p(a1, r1, y1), [cx, y1, cz], c, e)
            this.tri(p(a1, r, y0), p(a0, r, y0), [cx, y0, cz], c, e)
        }
        return this
    }

    /** Cilindro deitado no eixo z (canos), de z0 a z1. */
    cano(cx, cy, z0, z1, r, seg, c, e) {
        seg = seg || 8
        for (let i = 0; i < seg; i++) {
            const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2
            const p = (a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]
            this.quad(p(a0, z0), p(a0, z1), p(a1, z1), p(a1, z0), c, e, [Math.cos(am), Math.sin(am), 0])
            this.tri(p(a1, z0), p(a0, z0), [cx, cy, z0], c, e)
            this.tri(p(a0, z1), p(a1, z1), [cx, cy, z1], c, e)
        }
        return this
    }

    esfera(cx, cy, cz, rx, ry, rz, c, e, seg) {
        seg = seg || 8
        const an = seg, al = Math.max(3, seg >> 1)
        const P = (i, j) => {
            const th = i / an * Math.PI * 2, ph = j / al * Math.PI
            const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th)
            return [cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz]
        }
        c = cor(c)
        for (let j = 0; j < al; j++)
            for (let i = 0; i < an; i++) {
                const a = P(i, j), b = P(i + 1, j), d = P(i + 1, j + 1), f = P(i, j + 1)
                for (const v of [a, b, d, a, d, f]) this.vert(v[0], v[1], v[2], v[3], v[4], v[5], 0.5, 0.5, c, e || 0)
            }
        return this
    }

    /**
     * Pirâmide de base quadrada (orelhas, chifres, garras, tufos), da base ao
     * bico. Sem o fundo: ela sempre nasce de dentro de outra peça.
     */
    ponta(bx, by, bz, w, d, tx, ty, tz, c, e) {
        const b = [[bx - w, by, bz - d], [bx + w, by, bz - d], [bx + w, by, bz + d], [bx - w, by, bz + d]]
        const t = [tx, ty, tz]
        for (let i = 0; i < 4; i++) this.tri(b[i], b[(i + 1) % 4], t, c, e)
        return this
    }

    /** Um retângulo de frente (−z) ou de lado: manchas, costelas, cicatrizes coladas numa peça. */
    placa(x0, y0, x1, y1, z, c, e, lado) {
        if (lado) return this.quad([z, y0, x0], [z, y0, x1], [z, y1, x1], [z, y1, x0], c, e, [lado, 0, 0])
        return this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], c, e, [0, 0, z < 0 ? -1 : 1])
    }

    /** Anel achatado no chão (portais). */
    anel(cx, y, cz, r0, r1, seg, c, e) {
        for (let i = 0; i < seg; i++) {
            const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2
            this.quad([cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0], [cx + Math.cos(a0) * r1, y, cz + Math.sin(a0) * r1],
                      [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1], [cx + Math.cos(a1) * r0, y, cz + Math.sin(a1) * r0], c, e, [0, 1, 0])
        }
        return this
    }

    /** Junta outra geometria, transformada por m. */
    juntar(g, m) {
        const d = g.d
        if (!m) { for (let i = 0; i < d.length; i++) this.d.push(d[i]); return this }
        for (let i = 0; i < d.length; i += 12) {
            const x = d[i], y = d[i + 1], z = d[i + 2], nx = d[i + 3], ny = d[i + 4], nz = d[i + 5]
            let mx = m[0] * nx + m[4] * ny + m[8] * nz, my = m[1] * nx + m[5] * ny + m[9] * nz, mz = m[2] * nx + m[6] * ny + m[10] * nz
            const l = Math.hypot(mx, my, mz) || 1
            this.d.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
                        m[2] * x + m[6] * y + m[10] * z + m[14], mx / l, my / l, mz / l,
                        d[i + 6], d[i + 7], d[i + 8], d[i + 9], d[i + 10], d[i + 11])
        }
        return this
    }
}

// ------------------------------------------------------------------ monstros
//
// Os corrompidos são furries de laboratório que o vírus pegou: lobos, raposas,
// gatos e cachorros de jaleco rasgado, a hiena, o lagarto que cospe, o
// guaxinim inchado, o coelho saltador, o lobo uivador e o touro. Cada um é um
// boneco de partes rígidas (quadril, tronco, cabeça com a mandíbula, braços,
// pernas e o rabo), e cada parte gira em volta do seu pivô (`pose`).
//
// Os sinais do giro em x (rx): nas partes que apontam para baixo (braço,
// perna), positivo vai para a frente; nas que apontam para cima (tronco,
// cabeça), positivo vai para trás. Inclinar o tronco para a frente é negativo.

const PARTES = ["quadril", "tronco", "cabeca", "mandibula", "bracoE", "bracoD", "anteE", "anteD",
                "coxaE", "coxaD", "canelaE", "canelaD", "cauda"]

const OSSO = "#d8cfbd", FERIDA = "#5e1418", BOCA = "#22070a", LINGUA = "#9c2f3a"

/**
 * A cabeça de bicho: crânio, testa franzida, focinho (com a mandíbula à
 * parte, que abre), nariz, presas, olhos acesos e as orelhas da espécie.
 * `p.esp`: focinho (comprimento), larg, orelha (pontuda, longa, redonda,
 * caida, chifre, nenhuma), mascara, juba, crista, caolho, rasgada, dentuco.
 * Devolve os pontos dos olhos (o brilho deles é desenhado por cima).
 */
function cabecaFera(g, gm, p, s) {
    const C = p.cores, E = p.esp, k = p.hs * s, y0 = p.ny * s
    const b = (G, x0, ya, z0, x1, yb, z1, c, e) => G.caixa(x0 * k, y0 + ya * k, z0 * k, x1 * k, y0 + yb * k, z1 * k, c, e)
    const pt = (G, bx, by, bz, w, d, tx, ty, tz, c, e) => G.ponta(bx * k, y0 + by * k, bz * k, w * k, d * k, tx * k, y0 + ty * k, tz * k, c, e)
    const L = E.focinho, W = E.larg || 0.065, fz = -0.12 - L
    const claro = E.focinhoEscuro ? C.escuro : C.pelo2
    // o crânio e a testa franzida (brava)
    b(g, -0.13, 0.02, -0.12, 0.13, 0.25, 0.14, C.pelo)
    b(g, -0.135, 0.165, -0.127, 0.135, 0.205, -0.085, C.pelo3 || C.pelo)
    // bochechas peludas
    for (const sx of [-1, 1]) {
        pt(g, sx * 0.11, 0.06, -0.02, 0.02, 0.05, sx * 0.2, 0.0, 0.05, C.pelo)
        pt(g, sx * 0.11, 0.12, 0.02, 0.02, 0.04, sx * 0.19, 0.08, 0.1, C.pelo)
    }
    if (E.mascara) b(g, -0.137, 0.105, -0.13, 0.137, 0.18, -0.06, C.escuro)
    // o focinho: a ponte, o de cima (com o nariz e as presas) e o fundo da boca
    b(g, -W * 0.85, 0.13, Math.max(fz + 0.03, -0.26), W * 0.85, 0.175, -0.1, C.pelo)
    b(g, -W, 0.07, fz, W, 0.135, -0.1, claro)
    b(g, -0.034, 0.11, fz - 0.014, 0.034, 0.152, fz + 0.03, C.escuro)
    b(g, -W * 0.85, 0.045, fz + 0.02, W * 0.85, 0.071, -0.1, BOCA)
    for (const sx of [-1, 1]) pt(g, sx * W * 0.6, 0.07, fz + 0.03, 0.009, 0.009, sx * W * 0.6, 0.032, fz + 0.034, OSSO)
    if (E.dentuco) b(g, -0.024, 0.03, fz - 0.004, 0.024, 0.075, fz + 0.012, OSSO)
    // a mandíbula (parte própria: abre no ataque e no uivo)
    b(gm, -W * 0.9, 0.022, fz + 0.012, W * 0.9, 0.062, -0.06, claro)
    b(gm, -W * 0.6, 0.061, fz + 0.04, W * 0.6, 0.068, -0.08, LINGUA)
    for (const sx of [-1, 1]) pt(gm, sx * W * 0.55, 0.06, fz + 0.04, 0.008, 0.008, sx * W * 0.55, 0.095, fz + 0.04, OSSO)

    // os olhos: dois traços inclinados, bravos (o caolho tem uma cicatriz no lugar de um)
    const olhos = []
    for (const sx of [-1, 1]) {
        if (E.caolho && sx > 0) {
            b(g, 0.03, 0.115, -0.133, 0.105, 0.13, -0.125, FERIDA)
            b(g, 0.06, 0.09, -0.134, 0.075, 0.2, -0.126, FERIDA)
            continue
        }
        const q = (x, y) => [sx * x * k, y0 + y * k, -0.134 * k]
        const pts = sx < 0 ? [q(0.105, 0.162), q(0.035, 0.14), q(0.035, 0.118), q(0.105, 0.132)]
                           : [q(0.035, 0.14), q(0.105, 0.162), q(0.105, 0.132), q(0.035, 0.118)]
        g.quad(pts[0], pts[1], pts[2], pts[3], C.olho, 2.4, [0, 0, -1])
        olhos.push([sx * 0.07 * k, y0 + 0.14 * k, -0.14 * k])
    }
    if (E.cicatriz) b(g, -0.12, 0.2, -0.13, -0.02, 0.215, -0.126, FERIDA)

    // as orelhas
    const ore = E.orelha
    for (const sx of [-1, 1]) {
        const curta = E.rasgada && sx < 0
        if (ore === "pontuda") {
            const alt = (E.orelhaAlt || 0.44) * (curta ? 0.72 : 1)
            pt(g, sx * 0.085, 0.24, 0.04, 0.05, 0.035, sx * 0.125, alt, 0.065, C.pelo)
            pt(g, sx * 0.085, 0.245, 0.0, 0.026, 0.01, sx * 0.115, alt - 0.06, 0.03, E.orelhaDentro || C.pelo2)
            if (E.pontaEscura && !curta) pt(g, sx * 0.118, alt - 0.07, 0.06, 0.02, 0.02, sx * 0.125, alt + 0.005, 0.065, C.escuro)
            if (curta) b(g, sx > 0 ? 0.08 : -0.13, alt - 0.03, 0.03, sx > 0 ? 0.13 : -0.08, alt - 0.01, 0.08, FERIDA)
        } else if (ore === "longa") {
            // a orelha de coelho: comprida, uma delas dobrada para a frente
            const base = M4.trans(sx * 0.065 * k, y0 + 0.23 * k, 0.03 * k)
            const o = new Geo().caixa(-0.035 * k, 0, -0.016 * k, 0.035 * k, 0.24 * k, 0.016 * k, C.pelo)
            o.caixa(-0.022 * k, 0.02 * k, -0.019 * k, 0.022 * k, 0.22 * k, -0.015 * k, E.orelhaDentro || C.pelo2)
            const m1 = cadeia(base, M4.rz(-sx * 0.2), M4.rx(0.2))
            g.juntar(o, m1)
            const ponta = new Geo().caixa(-0.033 * k, 0, -0.015 * k, 0.033 * k, 0.17 * k, 0.015 * k, C.pelo)
            ponta.caixa(-0.02 * k, 0.01 * k, -0.018 * k, 0.02 * k, 0.15 * k, -0.014 * k, E.orelhaDentro || C.pelo2)
            const dobra = sx < 0 && E.dobrada ? -1.6 : -0.1
            g.juntar(ponta, cadeia(m1, M4.trans(0, 0.235 * k, 0), M4.rx(dobra)))
        } else if (ore === "redonda") {
            g.esfera(sx * 0.115 * k, y0 + 0.25 * k, 0.04 * k, 0.058 * k, 0.058 * k, 0.03 * k, C.pelo, 0, 6)
            g.esfera(sx * 0.115 * k, y0 + 0.25 * k, 0.012 * k, 0.034 * k, 0.034 * k, 0.012 * k, C.escuro, 0, 6)
        } else if (ore === "caida") {
            const o = new Geo().caixa(-0.022 * k, -0.21 * k, -0.055 * k, 0.022 * k, 0.02 * k, 0.055 * k, C.pelo3 || C.pelo)
            g.juntar(o, cadeia(M4.trans(sx * 0.135 * k, y0 + 0.23 * k, 0.02 * k), M4.rz(sx * (curta ? 0.7 : 0.3))))
        } else if (ore === "chifre") {
            pt(g, sx * 0.13, 0.2, 0.0, 0.045, 0.045, sx * 0.34, 0.27, -0.06, OSSO)
            pt(g, sx * 0.31, 0.25, -0.05, 0.028, 0.028, sx * 0.39, 0.46, -0.11, OSSO)
            pt(g, sx * 0.13, 0.12, 0.04, 0.02, 0.04, sx * 0.24, 0.1, 0.06, C.pelo)
        }
    }
    // a juba (hiena, lobos): tufos atrás da cabeça e no pescoço
    if (E.juba) {
        const cj = C.juba || C.pelo3 || C.pelo
        for (let i = 0; i < 7; i++) {
            const a = -1.3 + i * (2.6 / 6)
            pt(g, Math.sin(a) * 0.1, 0.16, 0.1 + Math.cos(a) * 0.03, 0.035, 0.035,
               Math.sin(a) * 0.2 * E.juba, 0.02, 0.2 + Math.cos(a) * 0.1 * E.juba, cj)
        }
        for (let i = 0; i < 4; i++) pt(g, 0, 0.24 - i * 0.06, 0.08 + i * 0.03, 0.03, 0.04, 0, 0.32 - i * 0.07, 0.2 + i * 0.05, cj)
    }
    // a crista (lagarto, Matriarca)
    if (E.crista) {
        for (let i = 0; i < 5; i++)
            pt(g, 0, 0.24 - i * 0.012, -0.07 + i * 0.055, 0.014, 0.024, 0, 0.33 - i * 0.025, -0.04 + i * 0.06,
               E.crista === "brilho" ? C.brilho : C.escuro, E.crista === "brilho" ? 1.2 : 0)
    }
    // o argolão do touro
    if (E.argola) {
        const c = "#c9ccd6"
        b(g, -0.04, 0.09, fz - 0.03, 0.04, 0.1, fz - 0.018, c)
        b(g, -0.045, 0.05, fz - 0.03, -0.035, 0.1, fz - 0.018, c)
        b(g, 0.035, 0.05, fz - 0.03, 0.045, 0.1, fz - 0.018, c)
        b(g, -0.04, 0.045, fz - 0.03, 0.04, 0.055, fz - 0.018, c)
    }
    return olhos
}

/** O rabo, apontando para trás (+z) e girado para baixo, a partir do pivô. */
function rabo(g, tipo, p, s) {
    const C = p.cores
    const t = new Geo()
    const sc = s
    const seg = (z0, z1, w0, w1, c, y) => {
        // um tronco de pirâmide em caixas: w0 → w1 ao longo de z
        const n = 3
        for (let i = 0; i < n; i++) {
            const a = z0 + (z1 - z0) * i / n, b2 = z0 + (z1 - z0) * (i + 1) / n
            const w = (w0 + (w1 - w0) * (i + 0.5) / n) * sc
            t.caixa(-w, (y || 0) - w, a * sc, w, (y || 0) + w, b2 * sc, c)
        }
    }
    let incl = 0.7
    if (tipo === "lobo") { seg(0, 0.42, 0.06, 0.075, C.pelo); t.ponta(0, 0, 0.42 * sc, 0.07 * sc, 0.05 * sc, 0, -0.02 * sc, 0.56 * sc, C.pelo3 || C.pelo) }
    else if (tipo === "raposa") {
        seg(0, 0.3, 0.06, 0.11, C.pelo)
        t.caixa(-0.1 * sc, -0.1 * sc, 0.3 * sc, 0.1 * sc, 0.1 * sc, 0.45 * sc, C.pelo)
        t.ponta(0, 0, 0.45 * sc, 0.09 * sc, 0.09 * sc, 0, 0, 0.62 * sc, C.pelo2)
        incl = 0.5
    } else if (tipo === "gato") {
        seg(0, 0.35, 0.03, 0.028, C.pelo)
        const c2 = new Geo().caixa(-0.028 * sc, -0.028 * sc, 0, 0.028 * sc, 0.028 * sc, 0.3 * sc, C.pelo)
        t.juntar(c2, cadeia(M4.trans(0, 0, 0.35 * sc), M4.rx(-1.1)))
        incl = 0.9
    } else if (tipo === "pompom") { t.esfera(0, 0, 0.06 * sc, 0.09 * sc, 0.09 * sc, 0.08 * sc, C.pelo2, 0, 6); incl = 0 }
    else if (tipo === "toco") { seg(0, 0.14, 0.06, 0.05, C.pelo); incl = 0.9 }
    else if (tipo === "touro") { seg(0, 0.45, 0.025, 0.02, C.pelo); t.ponta(0, 0, 0.42 * sc, 0.045 * sc, 0.045 * sc, 0, 0, 0.58 * sc, C.escuro); incl = 1.25 }
    else if (tipo === "hiena") { seg(0, 0.25, 0.04, 0.04, C.pelo); t.ponta(0, 0, 0.24 * sc, 0.06 * sc, 0.06 * sc, 0, 0, 0.4 * sc, C.escuro); incl = 1.0 }
    else if (tipo === "lagarto") { seg(0, 0.75, 0.12, 0.03, C.pelo); incl = 1.05 }
    else if (tipo === "aneis") {
        for (let i = 0; i < 5; i++) t.caixa(-0.075 * sc, -0.075 * sc, i * 0.09 * sc, 0.075 * sc, 0.075 * sc, (i + 1) * 0.09 * sc, i % 2 ? C.escuro : C.pelo)
        incl = 0.6
    }
    g.juntar(t, M4.rx(incl))
}

/**
 * O corpo de bicho, em pé. `p`: medidas em metros (multiplicadas por `s`),
 * cores, `esp` (a cabeça), `roupa` (jaleco, avental…), `rabo` e `extra`.
 */
function fera(p) {
    const s = p.s || 1
    const P = {}
    const parte = (nome, pai, pivo) => (P[nome] = { nome: nome, pai: pai, pivo: pivo.map((v) => v * s), geo: new Geo() })
    const b = (g, x0, y0, z0, x1, y1, z1, c, e) => g.caixa(x0 * s, y0 * s, z0 * s, x1 * s, y1 * s, z1 * s, c, e)
    const pt = (g, bx, by, bz, w, d, tx, ty, tz, c, e) => g.ponta(bx * s, by * s, bz * s, w * s, d * s, tx * s, ty * s, tz * s, c, e)
    const pl = (g, x0, y0, x1, y1, z, c, e, lado) => g.placa(x0 * s, y0 * s, x1 * s, y1 * s, z * s, c, e, lado)
    const C = p.cores

    parte("quadril", null, [0, p.hy, 0])
    parte("tronco", "quadril", [0, p.hy, 0])
    parte("cabeca", "tronco", [0, p.ny, 0])
    parte("mandibula", "cabeca", [0, p.ny + 0.06 * p.hs, -0.09 * p.hs])
    parte("bracoE", "tronco", [-p.sx, p.sy, 0])
    parte("bracoD", "tronco", [p.sx, p.sy, 0])
    parte("anteE", "bracoE", [-p.sx, p.sy - p.a1, 0])
    parte("anteD", "bracoD", [p.sx, p.sy - p.a1, 0])
    parte("coxaE", "quadril", [-p.hx, p.hy, 0])
    parte("coxaD", "quadril", [p.hx, p.hy, 0])
    parte("canelaE", "coxaE", [-p.hx, p.ky, 0])
    parte("canelaD", "coxaD", [p.hx, p.ky, 0])
    parte("cauda", "quadril", [0, p.hy - 0.02, p.td * 0.85])

    const tw = p.tw, td = p.td, hy = p.hy, sy = p.sy
    const calca = p.calca || C.pelo
    // quadril e tronco: o pelo, o peito mais largo e a barriga clara
    b(P.quadril.geo, -tw * 0.88, hy - 0.1, -td * 0.92, tw * 0.88, hy + 0.06, td * 0.92, calca)
    const g = P.tronco.geo
    b(g, -tw * 0.85, hy + 0.04, -td * 0.88, tw * 0.85, hy + 0.22, td * 0.88, C.pelo)
    b(g, -tw, hy + 0.2, -td, tw, sy + 0.04, td, C.pelo)
    b(g, -tw * 1.06, sy - 0.2, -td * 1.08, tw * 1.06, sy + 0.05, td * 1.02, C.pelo)
    pl(g, -tw * 0.55, hy + 0.1, tw * 0.55, sy - 0.04, -td - 0.004, C.pelo2)
    // a ferida: carne, costelas de fora e o vírus brilhando nela
    if (!p.semFerida) {
        const fx = p.feridaX || -0.35
        pl(g, tw * fx, hy + 0.24, tw * (fx + 0.5), hy + 0.46, -td - 0.03, FERIDA)
        for (let i = 0; i < 3; i++) pl(g, tw * (fx + 0.04), hy + 0.27 + i * 0.065, tw * (fx + 0.46), hy + 0.29 + i * 0.065, -td - 0.036, OSSO)
        pl(g, tw * (fx + 0.2), hy + 0.22, tw * (fx + 0.26), hy + 0.32, -td - 0.04, C.brilho, 1.4)
        pl(g, tw * (fx + 0.5), hy + 0.4, tw * (fx + 0.62), hy + 0.42, -td - 0.032, C.brilho, 1.4)
    }
    // tufos: no pescoço (o colar de pelo) e nos ombros
    for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2
        pt(g, Math.sin(a) * 0.07, sy + 0.04, Math.cos(a) * 0.06, 0.035, 0.035, Math.sin(a) * 0.15, sy - 0.05, Math.cos(a) * 0.13, C.pelo2)
    }
    for (const sx of [-1, 1]) {
        pt(g, sx * p.sx, sy + 0.02, 0, p.aw * 1.2, p.aw, sx * (p.sx + 0.09), sy + 0.12, 0.03, C.pelo)
        pt(g, sx * (p.sx - 0.03), sy, -p.aw * 0.5, p.aw, p.aw, sx * (p.sx + 0.04), sy + 0.09, -0.06, C.pelo)
    }
    b(g, -0.06, sy, -0.06, 0.06, p.ny + 0.05, 0.06, C.pelo)

    // a roupa rasgada: jaleco (aberto na frente), uniforme ou avental de hospital
    const R = p.roupa
    if (R) {
        const y0 = hy - 0.22, y1 = sy + 0.035, w = tw + 0.025, d = td + 0.025
        b(g, -w, y0, -td * 0.3, w, y1, d, R)
        for (const sx of [-1, 1]) b(g, sx * w, y0, -d, sx * tw * 0.42, y1, -td * 0.3, R)
        b(g, -tw * 0.75, sy - 0.03, -d - 0.012, -tw * 0.42, sy + 0.08, td * 0.4, R)
        b(g, tw * 0.42, sy - 0.03, -d - 0.012, tw * 0.75, sy + 0.08, td * 0.4, R)
        // a barra rasgada e as manchas
        for (let i = 0; i < 5; i++) {
            const a = i / 5 * Math.PI * 2 + 0.3
            const x = Math.cos(a) * w * 0.9, z = Math.sin(a) * d * 0.9
            if (z < -td * 0.3 && Math.abs(x) < tw * 0.42) continue
            pt(g, x, y0 + 0.01, z, 0.05, 0.04, x * 1.05, y0 - 0.1 - (i % 3) * 0.04, z * 1.05, R)
        }
        pl(g, -d * 0.2, hy + 0.05, d * 0.5, hy + 0.2, w + 0.006, FERIDA, 0, 1)
        pl(g, -tw * 0.95, y0 + 0.05, -tw * 0.6, y0 + 0.22, -d - 0.006, FERIDA)
        if (p.roupaDet) pl(g, tw * 0.5, sy - 0.16, tw * 0.85, sy - 0.12, -d - 0.006, p.roupaDet)
    }

    // braços: pelo, tufo no punho, a pata e as garras
    for (const [lado, sx] of [["E", -1], ["D", 1]]) {
        const x = sx * p.sx, a = p.aw
        const gb = P["braco" + lado].geo
        b(gb, x - a, sy - p.a1, -a, x + a, sy + 0.02, a, C.pelo)
        if (R) {
            b(gb, x - a * 1.3, sy - p.a1 * 0.7, -a * 1.3, x + a * 1.3, sy + 0.05, a * 1.3, R)
            pt(gb, x, sy - p.a1 * 0.7, a * 0.9, a, a * 0.5, x, sy - p.a1 * 0.92, a * 0.9, R)
        }
        const ga = P["ante" + lado].geo
        const y0 = sy - p.a1
        b(ga, x - a * 1.02, y0 - p.a2, -a * 1.02, x + a * 1.02, y0 + 0.02, a * 1.02, C.pelo)
        pt(ga, x, y0 - p.a2 * 0.75, a * 0.6, a * 1.1, a * 0.8, x + sx * 0.02, y0 - p.a2 * 0.55, a * 2.6, C.pelo2)
        const yh = y0 - p.a2
        b(ga, x - a * 1.2, yh - 0.075, -a * 1.35, x + a * 1.2, yh + 0.012, a * 1.15, C.pata || C.pelo)
        for (const dz of [-1, -0.2, 0.6])
            pt(ga, x + dz * a * 0.25 * sx, yh - 0.06, -a * 1.1 + dz * 0.01, a * 0.32, a * 0.28,
               x + dz * a * 0.4 * sx, yh - 0.06 - p.garra, -a * 1.6, C.garra || OSSO)
    }
    // pernas: coxa, canela, a pata grande com os dedos e as unhas
    for (const [lado, sx] of [["E", -1], ["D", 1]]) {
        const x = sx * p.hx, l = p.lw
        const gc = P["coxa" + lado].geo
        b(gc, x - l, p.ky, -l, x + l, hy + 0.02, l, calca)
        if (p.calca) for (const dz of [-1, 1]) pt(gc, x, p.ky + 0.02, dz * l * 0.6, l, l * 0.4, x + sx * 0.02, p.ky - 0.07, dz * l * 0.8, calca)
        const gn = P["canela" + lado].geo
        b(gn, x - l * 0.88, 0.08, -l * 0.88, x + l * 0.88, p.ky + 0.02, l * 0.88, C.pelo)
        b(gn, x - l * 1.15, 0, -l * (p.pe || 2.5), x + l * 1.15, 0.1, l * 1.05, C.pata || C.pelo)
        for (const dx of [-0.6, 0, 0.6])
            pt(gn, x + dx * l, 0.03, -l * (p.pe || 2.5), l * 0.25, l * 0.2, x + dx * l * 1.1, 0.0, -l * (p.pe || 2.5) - 0.06, C.garra || OSSO)
    }

    const olhos = cabecaFera(P.cabeca.geo, P.mandibula.geo, p, s)
    if (p.rabo) rabo(P.cauda.geo, p.rabo, p, s)
    // ajusta o rabo ao pivô (ele foi montado na origem)
    const pc = P.cauda.pivo
    const gt = P.cauda.geo
    P.cauda.geo = new Geo().juntar(gt, M4.trans(pc[0], pc[1], pc[2]))
    if (p.manchas) {
        // as pintas da hiena
        const M = [[0.6, 0.35, 1], [-0.5, 0.5, 1], [0.2, 0.15, 1], [-0.7, 0.2, -1], [0.4, 0.55, -1]]
        for (const [mx, my, lado] of M)
            pl(g, tw * mx - 0.03, hy + 0.2 + my * (sy - hy - 0.2), tw * mx + 0.03, hy + 0.25 + my * (sy - hy - 0.2), lado * (td + 0.008), C.escuro)
        for (const lado of ["E", "D"]) b(P["braco" + lado].geo, (lado === "E" ? -1 : 1) * p.sx - 0.025, sy - p.a1 * 0.5, -p.aw - 0.01, (lado === "E" ? -1 : 1) * p.sx + 0.025, sy - p.a1 * 0.3, -p.aw + 0.01, C.escuro)
    }
    if (p.extra) p.extra(P, p, s)
    return { partes: PARTES.map((n) => P[n]), por: P, s: s, p: p, cores: C, olhos: olhos }
}

// ---- o robô: os protogens corrompidos (protogens também são furries!) e o Sentinela Ômega

/** Um humanoide de placas com cabeça de protogen: os protogens corrompidos e o Sentinela. */
function robo(p) {
    const s = p.s || 1
    const P = {}
    const parte = (nome, pai, pivo) => (P[nome] = { nome: nome, pai: pai, pivo: pivo.map((v) => v * s), geo: new Geo() })
    const b = (g, x0, y0, z0, x1, y1, z1, c, e) => g.caixa(x0 * s, y0 * s, z0 * s, x1 * s, y1 * s, z1 * s, c, e)
    const C = p.cores

    parte("quadril", null, [0, p.hy, 0])
    parte("tronco", "quadril", [0, p.hy, 0])
    parte("cabeca", "tronco", [0, p.ny, 0])
    parte("mandibula", "cabeca", [0, p.ny, 0])
    parte("bracoE", "tronco", [-p.sx, p.sy, 0])
    parte("bracoD", "tronco", [p.sx, p.sy, 0])
    parte("anteE", "bracoE", [-p.sx, p.sy - p.a1, 0])
    parte("anteD", "bracoD", [p.sx, p.sy - p.a1, 0])
    parte("coxaE", "quadril", [-p.hx, p.hy, 0])
    parte("coxaD", "quadril", [p.hx, p.hy, 0])
    parte("canelaE", "coxaE", [-p.hx, p.ky, 0])
    parte("canelaD", "coxaD", [p.hx, p.ky, 0])
    parte("cauda", "quadril", [0, p.hy - 0.02, p.td * 0.85])

    b(P.quadril.geo, -p.tw * 0.85, p.hy - 0.08, -p.td * 0.9, p.tw * 0.85, p.hy + 0.06, p.td * 0.9, C.junta)
    const g = P.tronco.geo
    b(g, -p.tw * 0.8, p.hy + 0.04, -p.td * 0.85, p.tw * 0.8, p.hy + 0.2, p.td * 0.85, C.corpo)
    b(g, -p.tw, p.hy + 0.18, -p.td, p.tw, p.sy + 0.05, p.td, C.corpo)
    b(g, -p.tw * 0.9, p.hy + 0.3, -p.td - 0.035, p.tw * 0.9, p.sy, -p.td + 0.02, C.placa)
    b(g, -p.tw * 0.7, p.sy - 0.1, p.td - 0.01, p.tw * 0.7, p.sy + 0.04, p.td + 0.04, C.placa)
    b(g, -0.04, p.hy + 0.36, -p.td - 0.05, 0.05, p.hy + 0.39, -p.td - 0.03, C.brilho, 1.2)
    b(g, 0.02, p.hy + 0.38, -p.td - 0.05, 0.05, p.sy - 0.12, -p.td - 0.03, C.brilho, 1.2)
    for (const sx of [-1, 1]) b(g, sx * (p.sx - p.aw * 1.6), p.sy - 0.06, -p.aw * 1.5, sx * (p.sx + p.aw * 1.6), p.sy + 0.08, p.aw * 1.5, C.placa)
    b(g, -0.05, p.sy, -0.05, 0.05, p.ny + 0.04, 0.05, C.junta)
    for (const [lado, sx] of [["E", -1], ["D", 1]]) {
        const x = sx * p.sx, a = p.aw
        b(P["braco" + lado].geo, x - a, p.sy - p.a1, -a, x + a, p.sy + 0.02, a, C.corpo)
        const ga = P["ante" + lado].geo
        const y0 = p.sy - p.a1
        b(ga, x - a * 1.05, y0 - p.a2, -a * 1.05, x + a * 1.05, y0 + 0.02, a * 1.05, C.corpo)
        b(ga, x - a * 1.2, y0 - p.a2 * 0.75, -a * 1.25, x + a * 1.2, y0 - p.a2 * 0.25, a * 1.25, C.placa)
        const yh = y0 - p.a2
        for (const dz of [-0.6, 0, 0.6])
            ga.ponta(x * s, yh * s, dz * a * s, a * 0.35 * s, a * 0.3 * s, x * s, (yh - p.garra) * s, (dz * a - 0.02) * s, C.junta)
        b(ga, x - 0.012, y0 - p.a2 * 0.9, -a * 1.27, x + 0.012, y0 - 0.04, -a * 1.2, C.brilho, 1.1)
    }
    for (const [lado, sx] of [["E", -1], ["D", 1]]) {
        const x = sx * p.hx, l = p.lw
        b(P["coxa" + lado].geo, x - l, p.ky, -l, x + l, p.hy + 0.02, l, C.corpo)
        const gc = P["canela" + lado].geo
        b(gc, x - l * 0.9, 0.07, -l * 0.9, x + l * 0.9, p.ky + 0.02, l * 0.9, C.corpo)
        b(gc, x - l * 1.05, p.ky * 0.35, -l * 1.15, x + l * 1.05, p.ky * 0.95, -l * 0.4, C.placa)
        b(gc, x - l * 1.1, 0, -l * 2.4, x + l * 1.1, 0.09, l * 1.1, C.junta)
    }
    const olhos = cabecaProtogen(P.cabeca.geo, p, s)
    // o rabo de protogen, de placas
    if (p.rabo) {
        rabo(P.cauda.geo, p.rabo, p, s)
        const pc = P.cauda.pivo
        P.cauda.geo = new Geo().juntar(P.cauda.geo, M4.trans(pc[0], pc[1], pc[2]))
    }
    if (p.extra) p.extra(P, p, s)
    return { partes: PARTES.map((n) => P[n]), por: P, s: s, p: p, cores: C, olhos: olhos }
}

/** A cabeça de protogen: viseira preta com olhos de LED bravos e a boca de LED (o Sentinela ganha chifres e a coroa). */
function cabecaProtogen(g, p, s) {
    const C = p.cores, y = p.ny, k = p.hs * s
    const b = (x0, y0, z0, x1, y1, z1, c, e) => g.caixa(x0 * k, y * s + y0 * k, z0 * k, x1 * k, y * s + y1 * k, z1 * k, c, e)
    b(-0.15, 0.02, -0.15, 0.15, 0.3, 0.17, C.corpo)
    b(-0.155, 0.08, -0.12, 0.155, 0.26, 0.12, C.placa)
    b(-0.14, 0.04, -0.25, 0.14, 0.24, -0.12, C.visor)
    b(-0.105, 0.04, -0.33, 0.105, 0.15, -0.2, C.visor)
    g.quad([-0.115 * k, (y * s) + 0.18 * k, -0.252 * k], [-0.04 * k, (y * s) + 0.15 * k, -0.252 * k],
           [-0.04 * k, (y * s) + 0.12 * k, -0.252 * k], [-0.115 * k, (y * s) + 0.15 * k, -0.252 * k], C.olho, 2.2, [0, 0, -1])
    g.quad([0.04 * k, (y * s) + 0.15 * k, -0.252 * k], [0.115 * k, (y * s) + 0.18 * k, -0.252 * k],
           [0.115 * k, (y * s) + 0.15 * k, -0.252 * k], [0.04 * k, (y * s) + 0.12 * k, -0.252 * k], C.olho, 2.2, [0, 0, -1])
    b(-0.07, 0.07, -0.333, 0.07, 0.085, -0.329, C.olho, 1.6)
    for (const sx of [-1, 1]) {
        g.ponta(sx * 0.1 * k, y * s + 0.28 * k, 0.03 * k, 0.045 * k, 0.06 * k, sx * 0.13 * k, y * s + 0.5 * k, 0.07 * k, C.corpo)
        g.ponta(sx * 0.1 * k, y * s + 0.29 * k, -0.02 * k, 0.02 * k, 0.012 * k, sx * 0.125 * k, y * s + 0.44 * k, 0.02 * k, C.brilho, 1)
        if (!p.coroa) continue
        g.ponta(sx * 0.13 * k, y * s + 0.22 * k, 0.05 * k, 0.04 * k, 0.05 * k, sx * 0.34 * k, y * s + 0.55 * k, 0.2 * k, C.junta)
        g.ponta(sx * 0.15 * k, y * s + 0.12 * k, 0.08 * k, 0.03 * k, 0.04 * k, sx * 0.36 * k, y * s + 0.22 * k, 0.28 * k, C.placa)
    }
    if (p.coroa) b(-0.16, 0.31, 0.12, 0.16, 0.34, 0.15, C.brilho, 2)
    return [[-0.078 * k, y * s + 0.15 * k, -0.26 * k], [0.078 * k, y * s + 0.15 * k, -0.26 * k]]
}

// ---- as espécies

// as quatro caras do zumbi comum (lobo, raposa, gato, cachorro)
const VARIANTES = [
    { cores: { pelo: "#6d7079", pelo2: "#b9bcc6", pelo3: "#565961", escuro: "#232429", olho: "#ff2b5e", brilho: "#ff2b5e" },
      esp: { focinho: 0.17, orelha: "pontuda", rasgada: true, juba: 0.6 }, roupa: "#c9c4b8", roupaDet: "#3a6ea8", calca: "#3d4350", rabo: "lobo" },
    { cores: { pelo: "#b45a26", pelo2: "#efe6da", pelo3: "#8e461d", escuro: "#2a1d17", olho: "#ff2b5e", brilho: "#ff2b5e" },
      esp: { focinho: 0.16, larg: 0.055, orelha: "pontuda", orelhaAlt: 0.48, pontaEscura: true, cicatriz: true },
      roupa: "#7fa3a6", calca: "#5f8183", rabo: "raposa" },
    { cores: { pelo: "#2f2d34", pelo2: "#d9d4cc", pelo3: "#1f1e23", escuro: "#121114", olho: "#ffd02b", brilho: "#ff2b5e" },
      esp: { focinho: 0.08, larg: 0.07, orelha: "pontuda", orelhaAlt: 0.46, orelhaDentro: "#b97a8a", caolho: true },
      roupa: "#c9c4b8", roupaDet: "#a83a3a", calca: "#2e3340", rabo: "gato" },
    { cores: { pelo: "#7a5232", pelo2: "#c9a77c", pelo3: "#5b3c24", escuro: "#2a1a10", olho: "#ff2b5e", brilho: "#ff2b5e" },
      esp: { focinho: 0.15, larg: 0.07, orelha: "caida", rasgada: true },
      roupa: "#3e4a5a", roupaDet: "#c9a227", calca: "#2b3340", rabo: "toco" },
    // os protogens corrompidos, de placas: o de viseira vermelha (o da versão 1) e o branco
    { robo: true, rabo: "lobo",
      cores: { corpo: "#3a3e52", placa: "#61677f", junta: "#1c1d27", brilho: "#ff2b5e", visor: "#07070b", olho: "#ff3355",
               pelo: "#3a3e52", pelo2: "#61677f", pelo3: "#61677f" } },
    { robo: true, rabo: "raposa",
      cores: { corpo: "#c9ccd6", placa: "#8a90a0", junta: "#2a2d36", brilho: "#ff6a2a", visor: "#07070b", olho: "#ff6a2a",
               pelo: "#c9ccd6", pelo2: "#ff6a2a", pelo3: "#8a90a0" } }
]

// as medidas de cada tipo (o corpo) — as esferas de acerto do núcleo seguem estas
const MEDIDAS = {
    corrompido: { hy: 0.95, ky: 0.5, sy: 1.42, sx: 0.28, tw: 0.21, td: 0.13, aw: 0.055, lw: 0.065, hx: 0.1, ny: 1.48,
                  hs: 1, a1: 0.3, a2: 0.3, garra: 0.08 },
    corredor: { hy: 0.82, ky: 0.43, sy: 1.22, sx: 0.23, tw: 0.16, td: 0.11, aw: 0.045, lw: 0.055, hx: 0.09, ny: 1.27,
                hs: 0.9, a1: 0.33, a2: 0.37, garra: 0.14, rabo: "hiena", manchas: true, semFerida: false, feridaX: 0.1,
                cores: { pelo: "#a88a58", pelo2: "#d8c39a", pelo3: "#6b5636", juba: "#3b2f22", escuro: "#2b2117", olho: "#e1ff40", brilho: "#c8ff2e" },
                esp: { focinho: 0.15, larg: 0.06, focinhoEscuro: true, orelha: "redonda", juba: 1.1 } },
    cuspidor: { hy: 1.0, ky: 0.52, sy: 1.5, sx: 0.25, tw: 0.17, td: 0.12, aw: 0.045, lw: 0.06, hx: 0.09, ny: 1.6,
                hs: 0.95, a1: 0.32, a2: 0.32, garra: 0.07, rabo: "lagarto", feridaX: 0.05, pe: 2.8,
                cores: { pelo: "#3f6b4a", pelo2: "#a7c08a", pelo3: "#2f5238", escuro: "#1b2a1d", olho: "#4dff8a", brilho: "#4dff8a",
                         pata: "#355a3e", garra: "#1b2a1d" },
                esp: { focinho: 0.2, larg: 0.075, orelha: "nenhuma", crista: true },
                extra(P, p, s) {
                    // o papo de veneno, aceso, e as bolhas nas costas
                    P.tronco.geo.esfera(0, (p.sy - 0.02) * s, -0.15 * s, 0.09 * s, 0.08 * s, 0.07 * s, p.cores.brilho, 1.4, 6)
                    P.tronco.geo.esfera(0.06 * s, 1.3 * s, 0.14 * s, 0.09 * s, 0.1 * s, 0.07 * s, p.cores.brilho, 1.3, 6)
                    P.tronco.geo.esfera(-0.07 * s, 1.18 * s, 0.13 * s, 0.07 * s, 0.08 * s, 0.06 * s, p.cores.brilho, 1.3, 6)
                } },
    saltador: { hy: 0.86, ky: 0.48, sy: 1.2, sx: 0.22, tw: 0.17, td: 0.12, aw: 0.045, lw: 0.07, hx: 0.1, ny: 1.25,
                hs: 0.9, a1: 0.26, a2: 0.26, garra: 0.06, rabo: "pompom", pe: 3.6, roupa: "#9fb7c4", calca: "#9fb7c4", feridaX: 0.05,
                cores: { pelo: "#c9c2b6", pelo2: "#efe9df", pelo3: "#a8a094", escuro: "#3a3330", olho: "#ff3355", brilho: "#ff2b5e" },
                esp: { focinho: 0.07, larg: 0.07, orelha: "longa", dobrada: true, orelhaDentro: "#d99aa5", dentuco: true } },
    uivador: { hy: 1.0, ky: 0.52, sy: 1.48, sx: 0.28, tw: 0.2, td: 0.13, aw: 0.05, lw: 0.065, hx: 0.1, ny: 1.55,
               hs: 1.0, a1: 0.32, a2: 0.32, garra: 0.1, rabo: "lobo", semFerida: true,
               cores: { pelo: "#2b2930", pelo2: "#4d4a56", pelo3: "#1c1b20", juba: "#141317", escuro: "#0f0e12", olho: "#b18cff", brilho: "#8a6bff" },
               esp: { focinho: 0.19, larg: 0.06, orelha: "pontuda", orelhaAlt: 0.5, juba: 1.2 },
               extra(P, p, s) {
                   // a garganta acesa (o uivo sai dali) e as veias no peito
                   const g = P.tronco.geo, C = p.cores
                   g.esfera(0, (p.sy - 0.04) * s, -0.13 * s, 0.07 * s, 0.07 * s, 0.05 * s, C.brilho, 2, 6)
                   for (const sx of [-1, 1]) {
                       g.caixa(sx * 0.02 * s, (p.hy + 0.25) * s, -(p.td + 0.016) * s, sx * 0.035 * s, (p.sy - 0.08) * s, -(p.td + 0.008) * s, C.brilho, 1.5)
                       g.caixa(sx * 0.035 * s, (p.hy + 0.3) * s, -(p.td + 0.016) * s, sx * 0.12 * s, (p.hy + 0.315) * s, -(p.td + 0.008) * s, C.brilho, 1.5)
                   }
               } },
    brutamonte: { hy: 1.18, ky: 0.62, sy: 1.95, sx: 0.55, tw: 0.44, td: 0.3, aw: 0.13, lw: 0.14, hx: 0.22, ny: 2.0,
                  hs: 1.2, a1: 0.5, a2: 0.58, garra: 0.1, rabo: "touro", feridaX: 0.1, pe: 1.6, calca: "#3b3f48",
                  cores: { pelo: "#4a3226", pelo2: "#7a5a44", pelo3: "#2e1f17", escuro: "#1d1410", olho: "#ff6a2a", brilho: "#ff5a1f",
                           pata: "#1d1410", garra: "#1d1410" },
                  esp: { focinho: 0.13, larg: 0.1, orelha: "chifre", argola: true },
                  extra(P, p, s) {
                      const C = p.cores, g = P.tronco.geo
                      // a corcova de bisão, as algemas do laboratório e a correia com a fivela acesa
                      g.caixa(-0.36, 1.72, 0.0, 0.36, 2.12, 0.33, C.pelo3)
                      g.caixa(-0.26, 2.08, 0.06, 0.26, 2.26, 0.3, C.pelo3)
                      g.caixa(-0.45, 1.5, -0.32, 0.45, 1.57, -0.3, "#2b2b30")
                      g.caixa(-0.08, 1.48, -0.335, 0.08, 1.6, -0.315, C.brilho, 1.8)
                      for (const sx of [-1, 1]) {
                          const a = P["ante" + (sx < 0 ? "E" : "D")].geo
                          a.caixa(sx * 0.55 - 0.17, 0.95, -0.17, sx * 0.55 + 0.17, 1.1, 0.17, "#4a4d55")
                          a.caixa(sx * 0.55 - 0.175, 1.0, -0.175, sx * 0.55 + 0.175, 1.03, 0.175, C.brilho, 1.6)
                          a.caixa(sx * 0.55 - 0.03, 0.82, -0.2, sx * 0.55 + 0.03, 0.95, -0.17, "#4a4d55")
                      }
                  } },
    // ---- os chefes (muito maiores: `s`)
    lobo: { s: 1.9, hy: 0.95, ky: 0.5, sy: 1.42, sx: 0.37, tw: 0.3, td: 0.19, aw: 0.085, lw: 0.095, hx: 0.14, ny: 1.5,
            hs: 1.1, a1: 0.36, a2: 0.4, garra: 0.14, rabo: "lobo",
            cores: { pelo: "#5d6068", pelo2: "#c9ccd4", pelo3: "#3c3e45", juba: "#d6d9e0", escuro: "#18191d", olho: "#62f3ff", brilho: "#62f3ff" },
            esp: { focinho: 0.2, larg: 0.065, orelha: "pontuda", orelhaAlt: 0.46, juba: 1.4, cicatriz: true, rasgada: true },
            extra(P, p, s) {
                const g = P.tronco.geo, C = p.cores
                // a coleira de metal com espetos e a corrente arrebentada
                const y = (p.sy - 0.01) * s, r = 0.11 * s
                g.caixa(-r, y, -r, r, y + 0.06 * s, r, "#5a5e68")
                for (let i = 0; i < 6; i++) {
                    const a = i / 6 * Math.PI * 2
                    g.ponta(Math.sin(a) * r, y + 0.03 * s, Math.cos(a) * r, 0.015 * s, 0.015 * s, Math.sin(a) * r * 1.55, y + 0.03 * s, Math.cos(a) * r * 1.55, "#9aa0ab")
                }
                for (let i = 0; i < 3; i++) g.caixa(-0.02 * s, y - (0.04 + i * 0.07) * s, -(r + 0.02 * s), 0.02 * s, y - (i * 0.07 - 0.02) * s, -(r - 0.01 * s), i % 2 ? "#5a5e68" : "#9aa0ab")
                // espinhos de pelo na espinha
                for (let i = 0; i < 5; i++)
                    g.ponta(0, (p.sy - i * 0.09) * s, p.td * s, 0.03 * s, 0.03 * s, 0, (p.sy - i * 0.09 + 0.05) * s, (p.td + 0.13) * s, C.pelo3)
                // as cicatrizes acesas no peito (o vírus do alfa é ciano)
                for (let i = 0; i < 3; i++)
                    g.caixa((-0.15 + i * 0.05) * s, (p.hy + 0.35 + i * 0.03) * s, -(p.td + 0.016) * s, (-0.02 + i * 0.05) * s, (p.hy + 0.365 + i * 0.03) * s, -(p.td + 0.006) * s, C.brilho, 1.6)
            } },
    gosma: { s: 2.1, hy: 0.82, ky: 0.42, sy: 1.28, sx: 0.32, tw: 0.3, td: 0.2, aw: 0.06, lw: 0.085, hx: 0.14, ny: 1.33,
             hs: 1.25, a1: 0.28, a2: 0.28, garra: 0.08, rabo: "lagarto", pe: 2.8, semFerida: true,
             cores: { pelo: "#5b3f5e", pelo2: "#a98ab0", pelo3: "#3d2a40", escuro: "#1d1220", olho: "#c8ff2e", brilho: "#7dff3a",
                      pata: "#4b3350", garra: "#1d1220" },
             esp: { focinho: 0.15, larg: 0.12, orelha: "nenhuma", crista: "brilho" },
             extra(P, p, s) {
                 const g = P.tronco.geo, C = p.cores
                 // a barriga inchada, acesa por dentro, e os ovos nas costas
                 g.esfera(0, (p.hy + 0.22) * s, -0.05 * s, 0.4 * s, 0.38 * s, 0.32 * s, C.pelo2, 0, 10)
                 g.esfera(0, (p.hy + 0.22) * s, -0.06 * s, 0.33 * s, 0.32 * s, 0.33 * s, C.brilho, 0.5, 10)
                 for (const [x, y, z, r] of [[0.15, 1.15, 0.22, 0.1], [-0.12, 1.05, 0.24, 0.09], [0.0, 1.25, 0.2, 0.08], [-0.2, 1.2, 0.17, 0.07], [0.22, 0.98, 0.2, 0.07]])
                     g.esfera(x * s, y * s, z * s, r * s, r * s, r * s, C.brilho, 1.6, 6)
                 g.esfera(0, (p.sy - 0.04) * s, -0.2 * s, 0.11 * s, 0.09 * s, 0.08 * s, C.brilho, 1.8, 8)
             } },
    urso: { s: 2.3, hy: 0.9, ky: 0.46, sy: 1.38, sx: 0.32, tw: 0.27, td: 0.19, aw: 0.075, lw: 0.085, hx: 0.13, ny: 1.42,
            hs: 1.15, a1: 0.32, a2: 0.32, garra: 0.1, rabo: "toco", pe: 2.2,
            cores: { pelo: "#cdd6e2", pelo2: "#eef3f9", pelo3: "#a9b6c8", escuro: "#29323f", olho: "#62c8ff", brilho: "#9fe8ff",
                     pata: "#b9c4d4", garra: "#29323f" },
            esp: { focinho: 0.14, larg: 0.09, orelha: "redonda", cicatriz: true },
            extra(P, p, s) {
                const C = p.cores
                // os cristais de gelo crescendo nas costas, nos ombros e nos braços
                const cristal = (g, x, y, z, tx, ty, tz, w) => g.ponta(x * s, y * s, z * s, w * s, w * s, tx * s, ty * s, tz * s, C.brilho, 1.1)
                const g = P.tronco.geo
                for (const [x, y, z, h] of [[0.1, 1.3, 0.18, 0.22], [-0.12, 1.22, 0.19, 0.18], [0, 1.12, 0.2, 0.15], [0.18, 1.05, 0.18, 0.12], [-0.2, 1.36, 0.15, 0.16]])
                    cristal(g, x, y, z, x * 1.3, y + h * 0.5, z + h, 0.04)
                for (const sx of [-1, 1]) {
                    cristal(g, sx * 0.3, 1.42, 0, sx * 0.42, 1.62, 0.05, 0.04)
                    cristal(P["ante" + (sx < 0 ? "E" : "D")].geo, sx * 0.32, 0.9, 0.06, sx * 0.4, 0.98, 0.22, 0.03)
                }
                // o hálito de gelo no focinho
                P.cabeca.geo.caixa(-0.08 * s, (p.ny + 0.03) * s, -0.36 * s, 0.08 * s, (p.ny + 0.06) * s, -0.3 * s, C.brilho, 0.8)
            } },
    omega: { s: 2.35, hy: 0.95, ky: 0.5, sy: 1.42, sx: 0.3, tw: 0.23, td: 0.15, aw: 0.065, lw: 0.075, hx: 0.11, ny: 1.48,
             hs: 1.15, a1: 0.3, a2: 0.32, garra: 0.1, robo: true, coroa: true,
             cores: { corpo: "#2a2238", placa: "#4d3d6b", junta: "#140f1d", brilho: "#c94bff", visor: "#050308", olho: "#ff2b4e", pelo: "#2a2238" },
             extra(P, p, s) {
                 const C = p.cores
                 P.tronco.geo.esfera(0, 1.25 * s, -0.16 * s, 0.09 * s, 0.09 * s, 0.05 * s, C.brilho, 2.5, 10)
                 for (const sx of [-1, 1]) {
                     P.tronco.geo.ponta(sx * 0.32 * s, 1.47 * s, 0, 0.05 * s, 0.05 * s, sx * 0.42 * s, 1.75 * s, 0.05 * s, C.junta)
                     P.tronco.geo.ponta(sx * 0.27 * s, 1.47 * s, 0.05 * s, 0.04 * s, 0.04 * s, sx * 0.3 * s, 1.68 * s, 0.12 * s, C.placa)
                 }
                 for (let i = 0; i < 3; i++)
                     P.tronco.geo.caixa(-0.15 * s, (1.0 + i * 0.12) * s, 0.15 * s, 0.15 * s, (1.03 + i * 0.12) * s, 0.2 * s, C.brilho, 1.4)
             } }
}

/** O guaxinim inchado: uma bola de pelo cheia de bolhas acesas, que estoura. */
function modeloBomba() {
    const C = { pelo: "#6f6a66", pelo2: "#b7b0a8", pelo3: "#4e4945", escuro: "#1f1c1a", olho: "#ffb02e", brilho: "#ff9a1f" }
    const p = { hy: 0.5, ny: 1.06, hs: 0.95, cores: C, esp: { focinho: 0.1, larg: 0.06, orelha: "redonda", mascara: true } }
    const P = {}
    const parte = (nome, pai, pivo) => (P[nome] = { nome: nome, pai: pai, pivo: pivo, geo: new Geo() })
    parte("quadril", null, [0, 0.5, 0])
    parte("tronco", "quadril", [0, 0.5, 0])
    parte("cabeca", "tronco", [0, 1.06, 0])
    parte("mandibula", "cabeca", [0, 1.06 + 0.06 * 0.95, -0.09 * 0.95])
    parte("bracoE", "tronco", [-0.45, 0.85, 0]); parte("bracoD", "tronco", [0.45, 0.85, 0])
    parte("anteE", "bracoE", [-0.5, 0.6, 0]); parte("anteD", "bracoD", [0.5, 0.6, 0])
    parte("coxaE", "quadril", [-0.2, 0.42, 0]); parte("coxaD", "quadril", [0.2, 0.42, 0])
    parte("canelaE", "coxaE", [-0.2, 0.22, 0]); parte("canelaD", "coxaD", [0.2, 0.22, 0])
    parte("cauda", "quadril", [0, 0.45, 0.4])
    const g = P.tronco.geo
    g.esfera(0, 0.75, 0, 0.5, 0.45, 0.48, C.pelo, 0, 8)
    g.esfera(0, 0.7, -0.12, 0.38, 0.33, 0.4, C.pelo2, 0, 8)
    // as faixas que acendem (o pavio) e as bolhas
    g.esfera(0, 0.75, 0, 0.51, 0.05, 0.49, C.brilho, 2, 8)
    for (const [x, y, z, r] of [[0.3, 0.95, -0.28, 0.08], [-0.33, 0.7, -0.3, 0.07], [0.12, 0.45, -0.42, 0.06], [-0.1, 1.05, 0.3, 0.09], [0.38, 0.6, 0.2, 0.07], [-0.4, 0.95, 0.05, 0.06]])
        g.esfera(x, y, z, r, r, r, C.brilho, 2.2, 6)
    for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2
        g.ponta(Math.sin(a) * 0.12, 1.02, Math.cos(a) * 0.1, 0.05, 0.05, Math.sin(a) * 0.22, 0.95, Math.cos(a) * 0.2, C.pelo2)
    }
    const olhos = cabecaFera(P.cabeca.geo, P.mandibula.geo, p, 1)
    for (const [l, sx] of [["E", -1], ["D", 1]]) {
        P["braco" + l].geo.caixa(sx * 0.42, 0.6, -0.06, sx * 0.55, 0.88, 0.06, C.pelo)
        P["ante" + l].geo.caixa(sx * 0.44, 0.38, -0.07, sx * 0.56, 0.62, 0.07, C.pelo)
        P["ante" + l].geo.caixa(sx * 0.43, 0.32, -0.1, sx * 0.57, 0.4, 0.06, C.escuro)
        P["coxa" + l].geo.caixa(sx * 0.12, 0.22, -0.08, sx * 0.28, 0.45, 0.08, C.pelo)
        P["canela" + l].geo.caixa(sx * 0.11, 0, -0.2, sx * 0.29, 0.24, 0.09, C.escuro)
    }
    rabo(P.cauda.geo, "aneis", p, 1)
    P.cauda.geo = new Geo().juntar(P.cauda.geo, M4.trans(0, 0.45, 0.4))
    return { partes: PARTES.map((n) => P[n]), por: P, s: 1, p: { hy: 0.5 }, cores: C, olhos: olhos }
}

const modelos = {}
/** O modelo do tipo (e da variante, no zumbi comum), montado uma vez só. */
function modelo(tipo, variante) {
    const v = tipo === "corrompido" ? (variante || 0) % VARIANTES.length : 0
    const chave = tipo + ":" + v
    if (modelos[chave]) return modelos[chave]
    let mod
    if (tipo === "bomba") mod = modeloBomba()
    else {
        let m = Object.assign({}, MEDIDAS[tipo])
        if (tipo === "corrompido") m = Object.assign(m, VARIANTES[v])
        mod = m.robo ? robo(m) : fera(m)
    }
    // pronto: a geometria vira um bloco de floats (o desenho de cada quadro lê bem mais rápido)
    for (const p of mod.partes) p.geo.d = new Float32Array(p.geo.d)
    return (modelos[chave] = mod)
}

/** As cores do monstro (o pelo, para os pedaços que voam quando ele morre; os olhos). */
function coresDe(e) { return modelo(e.tipo, e.variante).cores }

/**
 * A pose do monstro agora: rotação (rx, ry, rz) de cada parte e o que vai na
 * raiz (altura, queda). Lê só o estado que o núcleo deixa.
 */
function pose(e, t) {
    const r = {}
    for (const n of PARTES) r[n] = [0, 0, 0]
    const vel = Math.hypot(e.vx, e.vz)
    const tipo = e.tipo
    const corre = e.vel > 2.6 || tipo === "corredor"
    const ritmo = e.def.grande ? 1.6 / (e.def.escala || 1) : corre ? 2.6 : 2.2
    const fase = e.passo * ritmo + e.semente * 10
    const anda = Math.min(1, vel / 1.2)
    const a = Math.sin(fase), c = Math.cos(fase)
    const amp = corre ? 0.75 : 0.42
    const raiz = { y: 0, rx: 0, rz: 0, ry: 0, escala: 1 }
    const h = e.def.altura

    // pernas (quem manca puxa uma delas)
    const ampE = amp * (e.manca ? 0.45 : 1)
    r.coxaE[0] = a * ampE * anda
    r.coxaD[0] = -a * amp * anda
    r.canelaE[0] = -Math.max(0, -c) * ampE * 1.3 * anda - 0.08
    r.canelaD[0] = -Math.max(0, c) * amp * 1.3 * anda - 0.08
    raiz.y = Math.abs(c) * 0.05 * anda * (corre ? 1.6 : 1)
    if (e.manca) { raiz.rz = Math.sin(fase) * 0.09 * anda; raiz.y -= Math.max(0, -a) * 0.05 * anda }

    // braços: o zumbi anda com eles esticados para a frente; os outros balançam
    const zumbi = tipo === "corrompido" || tipo === "omega"
    let bE = zumbi ? 1.3 : -a * amp * 0.8 * anda, bD = zumbi ? 1.15 : a * amp * 0.8 * anda
    if (zumbi) { bE += Math.sin(t * 2.1 + e.semente * 9) * 0.14; bD += Math.sin(t * 1.8 + e.semente * 5) * 0.14 }
    if (tipo === "saltador") { bE = 0.7 + bE * 0.3; bD = 0.7 + bD * 0.3 }
    if (tipo === "corredor") { bE = -0.2 + bE; bD = -0.2 + bD }
    r.bracoE[0] = bE; r.bracoD[0] = bD
    r.anteE[0] = zumbi ? 0.25 : 0.45; r.anteD[0] = zumbi ? 0.35 : 0.45
    r.bracoE[2] = -0.08; r.bracoD[2] = 0.08
    // os chefes (e o touro) andam em guarda: braços abertos, garras para a frente
    if ((e.def.chefe && tipo !== "omega") || tipo === "brutamonte") {
        r.bracoE[0] = 0.5 + bE * 0.5; r.bracoD[0] = 0.5 + bD * 0.5
        r.bracoE[2] = -0.35; r.bracoD[2] = 0.35
        r.anteE[0] = r.anteD[0] = 0.75
    }

    // o tronco curvado (o zumbi encurvado, a hiena quase de quatro) e a cabeça compensando
    const curva = { corrompido: 0.2, corredor: 0.55, saltador: 0.25, uivador: 0.15, cuspidor: 0.12, brutamonte: 0.18,
                    lobo: 0.42, gosma: 0.1, urso: 0.25, omega: 0.05, bomba: 0.05 }[tipo] || 0.15
    r.tronco[0] = -curva - (corre ? 0.2 : 0) * anda
    r.tronco[1] = Math.sin(fase) * 0.08 * anda
    r.cabeca[0] = -r.tronco[0] * 0.75
    // a cabeça torta do zumbi, e o tique do vírus
    const tic = Math.sin(t * 13 + e.semente * 40) > 0.94 ? Math.sin(t * 77) * 0.25 : 0
    r.cabeca[2] = (e.semente - 0.5) * (zumbi ? 0.5 : 0.2) + tic + Math.sin(t * 1.3 + e.semente * 3) * 0.06
    // a boca: entreaberta, mastigando o ar de vez em quando
    r.mandibula[0] = -0.08 - Math.pow(Math.max(0, Math.sin(t * 2.3 + e.semente * 17)), 6) * 0.3
    // o rabo balança com o passo
    r.cauda[1] = Math.sin(t * 2.2 + e.semente * 9) * (0.15 + 0.2 * anda)
    r.cauda[0] = Math.sin(fase) * 0.1 * anda

    if (tipo === "bomba") {
        r.bracoE[0] = -a * 0.6 * anda; r.bracoD[0] = a * 0.6 * anda
        r.bracoE[2] = -0.5; r.bracoD[2] = 0.5
        r.tronco[0] = -0.05 * anda
        r.cabeca[0] = 0
        if (e.estado === "pavio") {
            const k = Math.min(1, e.tm / e.def.preparo)
            raiz.escala = 1 + k * 0.25 + Math.sin(t * 40) * 0.04 * k
            r.bracoE[2] = -1.3; r.bracoD[2] = 1.3
            r.mandibula[0] = -0.5 * k
        }
    }

    const est = e.estado
    const abre = (k) => { r.mandibula[0] = Math.min(r.mandibula[0], -0.55 * k) }
    if (est === "atacando") {
        const k = e.tm / e.def.preparo
        if (k < 1) {
            // ergue as garras...
            r.bracoE[0] = r.bracoD[0] = 1.4 + k * 1.3
            r.anteE[0] = r.anteD[0] = 0.6 * k
            r.tronco[0] = -curva + 0.2 * k
            abre(k)
        } else {
            // ...e desce com tudo, mordendo
            const q = Math.min(1, (e.tm - e.def.preparo) / 0.15)
            r.bracoE[0] = r.bracoD[0] = 2.7 - q * 2.2
            r.anteE[0] = r.anteD[0] = 0.2
            r.tronco[0] = -curva + 0.2 - q * 0.6
            abre(1 - q)
        }
    } else if (est === "cuspindo" || est === "morteiro") {
        const ini = est === "morteiro" ? 0.75 : 0.55
        const k = Math.min(1, e.tm / ini)
        r.tronco[0] = e.tm < ini ? 0.3 * k : 0.3 - Math.min(1, (e.tm - ini) / 0.12) * 0.75
        r.cabeca[0] = e.tm < ini ? 0.35 * k : -0.1
        abre(e.tm < ini ? k : 1.2)
        r.bracoE[0] = r.bracoD[0] = 0.3; r.bracoE[2] = -0.6; r.bracoD[2] = 0.6
    } else if (est === "preparando" || est === "invocando" || est === "pisao" || est === "chocando") {
        // o rugido: peito para cima, braços abertos, a boca escancarada
        const k = Math.min(1, e.tm / 0.4)
        r.tronco[0] = 0.25 * k
        r.cabeca[0] = 0.45 * k + Math.sin(t * 30) * 0.05
        abre(k * 1.2)
        r.bracoE[0] = r.bracoD[0] = 0.4 + (est === "pisao" ? 2.2 * Math.min(1, e.tm / 1.0) : 0)
        r.bracoE[2] = -1.0 * k; r.bracoD[2] = 1.0 * k
        if (est === "pisao" && e.tm >= 1.0) {
            const q = Math.min(1, (e.tm - 1.0) / 0.12)
            r.bracoE[0] = r.bracoD[0] = 2.6 - q * 2.4
            r.tronco[0] = -0.55 * q
            raiz.y = -0.15 * q
        }
        if (est === "chocando") { r.tronco[0] = -0.4 * k + Math.sin(t * 25) * 0.06; r.cabeca[0] = 0.3 }
        if (est === "invocando" && (tipo === "lobo" || tipo === "uivador")) { r.cabeca[0] = 1.0 * k; r.tronco[0] = 0.2 * k }
    } else if (est === "uivando") {
        // o uivo: o focinho para o céu
        const k = Math.min(1, e.tm / 0.35) * (e.tm > 1.2 ? Math.max(0, 1 - (e.tm - 1.2) / 0.3) : 1)
        r.tronco[0] = -curva + (curva + 0.2) * k
        r.cabeca[0] = r.cabeca[0] * (1 - k) + 1.05 * k
        abre(k * 1.1)
        r.bracoE[0] = r.bracoD[0] = -0.25 * k + r.bracoE[0] * (1 - k)
    } else if (est === "investida") {
        // a cabeça baixa: os chifres na frente
        r.tronco[0] = -0.75
        r.cabeca[0] = -0.1
        r.bracoE[0] = r.bracoD[0] = -0.6
        const f = e.tm * 14
        r.coxaE[0] = Math.sin(f) * 0.9; r.coxaD[0] = -Math.sin(f) * 0.9
        r.canelaE[0] = -Math.max(0, -Math.cos(f)) * 1.1; r.canelaD[0] = -Math.max(0, Math.cos(f)) * 1.1
        r.cauda[0] = -0.6
    } else if (est === "atordoado") {
        r.tronco[0] = -0.55 + Math.sin(t * 3) * 0.08
        r.cabeca[0] = -0.5; r.cabeca[2] = Math.sin(t * 4) * 0.3
        r.bracoE[0] = r.bracoD[0] = -0.1
        r.mandibula[0] = -0.35
    } else if (est === "rajada") {
        r.tronco[0] = 0.15
        r.bracoD[0] = 1.6; r.bracoE[0] = 0.6
    } else if (est === "agachando") {
        // agacha para o bote
        const k = Math.min(1, e.tm / 0.3)
        r.tronco[0] = -0.65 * k
        r.cabeca[0] = 0.55 * k
        r.coxaE[0] = r.coxaD[0] = 1.0 * k
        r.canelaE[0] = r.canelaD[0] = -1.6 * k
        r.bracoE[0] = r.bracoD[0] = 0.5
        raiz.y = -h * 0.12 * k
        r.cauda[0] = -0.4 * k
        abre(0.5 * k)
    } else if (est === "saltando") {
        // no ar: pernas encolhidas, garras na frente
        r.tronco[0] = -0.35
        r.cabeca[0] = 0.35
        r.coxaE[0] = r.coxaD[0] = 1.3
        r.canelaE[0] = r.canelaD[0] = -1.3
        r.bracoE[0] = r.bracoD[0] = 1.9
        r.anteE[0] = r.anteD[0] = 0.3
        r.bracoE[2] = -0.3; r.bracoD[2] = 0.3
        r.cauda[0] = -0.3
        abre(1.1)
    } else if (est === "soprando") {
        r.tronco[0] = -0.15
        r.cabeca[0] = -0.05
        abre(e.tm > 0.5 ? 1.4 : e.tm / 0.5)
        r.bracoE[0] = r.bracoD[0] = 0.5; r.bracoE[2] = -0.7; r.bracoD[2] = 0.7
    } else if (est === "arremessando") {
        if (e.tm < 0.9) {
            const k = Math.min(1, e.tm / 0.6)
            r.bracoE[0] = r.bracoD[0] = 3.0 * k
            r.tronco[0] = 0.3 * k
        } else {
            const q = Math.min(1, (e.tm - 0.9) / 0.15)
            r.bracoE[0] = r.bracoD[0] = 3.0 - q * 2.3
            r.tronco[0] = 0.3 - q * 0.7
        }
        abre(0.8)
    } else if (est === "recuperando" && (tipo === "saltador" || tipo === "lobo")) {
        const k = Math.max(0, 1 - e.tm / 0.5)
        r.coxaE[0] = r.coxaD[0] = 0.8 * k
        r.canelaE[0] = r.canelaD[0] = -1.2 * k
        raiz.y = -h * 0.08 * k
    } else if (est === "surgindo") {
        // saindo do chão, agarrando a borda
        const k = Math.min(1, e.tm / e.def.surge)
        r.bracoE[0] = r.bracoD[0] = 2.8 - k * 1.5
        r.tronco[0] = -0.4 * (1 - k)
        abre(1 - k)
    }

    // a festa: dois jeitos de dançar, pela semente de cada um
    if (e.dancando > 0 && est !== "morrendo") {
        const b = t * 6.2 + e.semente * 9, sb = Math.sin(b), meia = Math.sin(b * 0.5)
        raiz.y = Math.abs(sb) * 0.07
        if (e.semente < 0.5) {
            // os braços para o alto, balançando
            r.bracoE[0] = 2.7 + sb * 0.35; r.bracoD[0] = 2.7 - sb * 0.35
            r.bracoE[2] = -0.35; r.bracoD[2] = 0.35
            r.anteE[0] = r.anteD[0] = 0.5
        } else {
            // a dança do robô: cotovelos dobrados, socando o ar
            r.bracoE[0] = 0.4 + Math.max(0, sb) * 1.4; r.bracoD[0] = 0.4 + Math.max(0, -sb) * 1.4
            r.anteE[0] = r.anteD[0] = 1.6
            r.bracoE[2] = -0.2; r.bracoD[2] = 0.2
        }
        r.tronco[0] = 0.05; r.tronco[1] = meia * 0.35; r.tronco[2] = meia * 0.1
        r.quadril[1] = -meia * 0.2
        r.cabeca[0] = 0.1 + sb * 0.15; r.cabeca[2] = meia * 0.25
        r.coxaE[0] = Math.max(0, sb) * 0.5; r.canelaE[0] = -Math.max(0, sb) * 0.8
        r.coxaD[0] = Math.max(0, -sb) * 0.5; r.canelaD[0] = -Math.max(0, -sb) * 0.8
        r.cauda[1] = Math.sin(b * 2) * 0.7
        r.mandibula[0] = -0.25
    }

    // tranco quando leva tiro
    if (e.atingido > 0 && est !== "morrendo") {
        r.tronco[0] += e.atingido * 0.35
        r.cabeca[0] += e.atingido * 0.3
    }

    if (est === "morrendo") {
        const k = Math.min(1, e.tm / 0.55)
        const q = k * k
        raiz.rx = -e.queda * q * 1.5
        raiz.y = -Math.max(0, e.tm - 1.3) * 0.6
        r.bracoE[0] = 1.2 * (1 - q) + 2.6 * q * (e.queda > 0 ? 1 : 0.2)
        r.bracoD[0] = 1.0 * (1 - q) + 2.4 * q * (e.queda > 0 ? 1 : 0.2)
        r.bracoE[2] = -0.6 * q; r.bracoD[2] = 0.6 * q
        r.coxaE[0] = 0.4 * q; r.canelaE[0] = -0.6 * q
        r.tronco[0] = 0
        r.cabeca[2] = 0.4 * q
        r.mandibula[0] = -0.5 * q
        r.cauda[0] = 0.4 * q
    }
    return { r: r, raiz: raiz }
}

/**
 * As matrizes de cada parte no mundo, para o monstro `e`.
 * A raiz gira em volta dos pés para cair.
 */
function matrizes(e, t) {
    const mod = modelo(e.tipo, e.variante)
    const ps = pose(e, t)
    const k = ps.raiz.escala * (e.esc || 1)
    let raiz = cadeia(M4.trans(e.x, e.y + ps.raiz.y, e.z), M4.ry(-e.ang))
    if (ps.raiz.rx) {
        // cair: gira no pé, para trás ou para frente
        const pivoZ = e.queda > 0 ? 0.15 : -0.15
        raiz = cadeia(raiz, M4.trans(0, 0, pivoZ), M4.rx(ps.raiz.rx), M4.trans(0, 0, -pivoZ))
    }
    if (ps.raiz.rz) raiz = M4.mul(raiz, M4.rz(ps.raiz.rz))
    if (k !== 1) raiz = cadeia(raiz, M4.esc(k))
    const out = {}
    for (const p of mod.partes) {
        const rot = ps.r[p.nome]
        const pai = p.pai ? out[p.pai] : raiz
        let m = M4.trans(p.pivo[0], p.pivo[1], p.pivo[2])
        if (rot[1]) m = M4.mul(m, M4.ry(rot[1]))
        if (rot[0]) m = M4.mul(m, M4.rx(rot[0]))
        if (rot[2]) m = M4.mul(m, M4.rz(rot[2]))
        if (p.nome === "cabeca" && PZ.segredos && PZ.segredos.cabecudo) m = M4.mul(m, M4.esc(1.9))
        m = M4.mul(m, M4.trans(-p.pivo[0], -p.pivo[1], -p.pivo[2]))
        out[p.nome] = M4.mul(pai, m)
    }
    return { mod: mod, m: out }
}

// ------------------------------------------------------------------ armas
//
// No espaço da mão: o cano aponta para −z, o cabo fica na origem. A cor do
// brilho muda com a Forja: ciano, magenta, dourado e o carmesim do Mk IV.

const BRILHO_NIVEL = ["#62f3ff", "#ff4fd8", "#ffc93c", "#ff5a2a"]
const CORPO_NIVEL = [["#2c303c", "#4b5263", "#15171d"], ["#2b2236", "#4f3d63", "#140f1b"], ["#3a3020", "#6b5a35", "#1a150c"],
                     ["#3a1a1a", "#6b2e28", "#1a0b0b"]]

function geoArma(id, nivel) {
    const g = new Geo()
    const L = BRILHO_NIVEL[nivel - 1], [A, B, Cc] = CORPO_NIVEL[nivel - 1]
    let boca = [0, 0.05, -0.3], mira = 0.075
    switch (id) {
        case "faisca":
            g.caixa(-0.022, 0.0, -0.21, 0.022, 0.065, 0.03, A)
            g.caixa(-0.024, 0.04, -0.22, 0.024, 0.075, 0.035, B)
            g.caixa(-0.018, -0.12, -0.02, 0.018, 0.01, 0.03, Cc)
            g.caixa(-0.026, 0.045, -0.18, -0.022, 0.06, -0.04, L, 1.6)
            g.caixa(0.022, 0.045, -0.18, 0.026, 0.06, -0.04, L, 1.6)
            g.cano(0, 0.035, -0.245, -0.2, 0.014, 6, Cc)
            g.caixa(-0.006, 0.075, -0.2, 0.006, 0.088, -0.19, L, 2)
            boca = [0, 0.035, -0.25]; mira = 0.085
            break
        case "enxame":
            g.caixa(-0.03, -0.01, -0.3, 0.03, 0.07, 0.08, A)
            g.caixa(-0.032, 0.05, -0.28, 0.032, 0.085, 0.06, B)
            g.caixa(-0.02, -0.17, -0.12, 0.02, 0.0, -0.06, Cc)
            g.caixa(-0.016, -0.12, 0.0, 0.016, 0.01, 0.04, Cc)
            g.caixa(-0.015, 0.0, 0.08, 0.015, 0.05, 0.2, Cc)
            g.cano(0, 0.03, -0.38, -0.29, 0.016, 6, Cc)
            g.caixa(-0.034, 0.02, -0.26, -0.03, 0.04, -0.02, L, 1.6)
            g.caixa(0.03, 0.02, -0.26, 0.034, 0.04, -0.02, L, 1.6)
            g.caixa(-0.008, 0.085, -0.1, 0.008, 0.1, -0.09, L, 2)
            boca = [0, 0.03, -0.39]; mira = 0.1
            break
        case "estilhaco":
            g.caixa(-0.035, 0.0, -0.25, 0.035, 0.08, 0.1, A)
            g.cano(-0.018, 0.06, -0.62, -0.2, 0.02, 6, Cc)
            g.cano(0.018, 0.06, -0.62, -0.2, 0.02, 6, Cc)
            g.caixa(-0.04, 0.01, -0.5, 0.04, 0.05, -0.32, B)
            g.caixa(-0.042, 0.02, -0.48, -0.038, 0.04, -0.34, L, 1.6)
            g.caixa(0.038, 0.02, -0.48, 0.042, 0.04, -0.34, L, 1.6)
            g.caixa(-0.02, -0.13, -0.02, 0.02, 0.01, 0.04, Cc)
            g.caixa(-0.025, -0.02, 0.1, 0.025, 0.06, 0.28, B)
            g.caixa(-0.006, 0.08, -0.6, 0.006, 0.095, -0.59, L, 2)
            boca = [0, 0.06, -0.63]; mira = 0.1
            break
        case "lanca":
            g.caixa(-0.03, 0.0, -0.32, 0.03, 0.08, 0.1, A)
            g.cano(0, 0.045, -0.62, -0.3, 0.017, 6, Cc)
            g.caixa(-0.035, 0.015, -0.48, 0.035, 0.07, -0.3, B)
            g.caixa(-0.018, -0.2, -0.16, 0.018, 0.0, -0.08, Cc)
            g.caixa(-0.018, -0.12, -0.02, 0.018, 0.01, 0.04, Cc)
            g.caixa(-0.024, -0.02, 0.1, 0.024, 0.07, 0.3, B)
            // a mira holográfica
            g.caixa(-0.025, 0.08, -0.14, 0.025, 0.09, -0.04, Cc)
            g.caixa(-0.024, 0.09, -0.135, -0.019, 0.14, -0.125, Cc)
            g.caixa(0.019, 0.09, -0.135, 0.024, 0.14, -0.125, Cc)
            g.caixa(-0.004, 0.11, -0.132, 0.004, 0.118, -0.128, L, 3)
            g.caixa(-0.037, 0.03, -0.46, -0.033, 0.05, -0.33, L, 1.6)
            g.caixa(0.033, 0.03, -0.46, 0.037, 0.05, -0.33, L, 1.6)
            boca = [0, 0.045, -0.63]; mira = 0.114
            break
        case "tempestade":
            g.caixa(-0.045, -0.01, -0.36, 0.045, 0.1, 0.12, A)
            g.cano(0, 0.05, -0.7, -0.34, 0.022, 8, Cc)
            g.cano(0, 0.05, -0.62, -0.38, 0.036, 8, B)
            g.cilindro(0, -0.05, -0.17, -0.02, 0.08, 10, B)
            g.cilindro(0, -0.05, -0.12, -0.07, 0.082, 10, L, 1.4)
            g.caixa(-0.02, -0.12, 0.02, 0.02, 0.0, 0.07, Cc)
            g.caixa(-0.028, -0.02, 0.12, 0.028, 0.08, 0.32, B)
            g.caixa(-0.006, 0.1, -0.3, 0.006, 0.115, -0.29, L, 2)
            boca = [0, 0.05, -0.71]; mira = 0.12
            break
        case "gama":
            g.caixa(-0.04, 0.0, -0.3, 0.04, 0.09, 0.12, A)
            g.caixa(-0.045, 0.02, -0.75, -0.025, 0.07, -0.28, B)
            g.caixa(0.025, 0.02, -0.75, 0.045, 0.07, -0.28, B)
            g.caixa(-0.012, 0.035, -0.73, 0.012, 0.055, -0.3, L, 3)
            for (let i = 0; i < 4; i++) g.caixa(-0.05, 0.015, -0.68 + i * 0.1, 0.05, 0.075, -0.66 + i * 0.1, Cc)
            g.caixa(-0.02, -0.13, -0.02, 0.02, 0.01, 0.04, Cc)
            g.caixa(-0.026, -0.01, 0.12, 0.026, 0.08, 0.3, B)
            g.caixa(-0.03, 0.09, -0.2, 0.03, 0.13, -0.05, Cc)
            g.caixa(-0.02, 0.1, -0.205, 0.02, 0.12, -0.2, L, 2.5)
            boca = [0, 0.045, -0.76]; mira = 0.12
            break
        case "supernova":
            g.cano(0, 0.07, -0.55, 0.15, 0.065, 10, A)
            g.cano(0, 0.07, -0.58, -0.5, 0.075, 10, B)
            g.cano(0, 0.07, -0.585, -0.575, 0.07, 10, L, 2.2)
            g.cano(0, 0.07, -0.2, -0.17, 0.07, 10, L, 1.5)
            g.caixa(-0.02, -0.12, -0.1, 0.02, 0.01, -0.04, Cc)
            g.caixa(-0.02, -0.12, 0.05, 0.02, 0.01, 0.1, Cc)
            g.caixa(0.06, 0.1, -0.3, 0.1, 0.15, -0.15, Cc)
            g.caixa(0.07, 0.15, -0.29, 0.09, 0.16, -0.27, L, 2)
            boca = [0, 0.07, -0.6]; mira = 0.155
            break
        case "tesla":
            g.caixa(-0.04, 0.0, -0.25, 0.04, 0.08, 0.1, A)
            g.cano(0, 0.05, -0.45, -0.25, 0.03, 8, Cc)
            for (let i = 0; i < 5; i++) g.cano(0, 0.05, -0.43 + i * 0.04, -0.41 + i * 0.04, 0.05, 8, B)
            for (let i = 0; i < 5; i++) g.cano(0, 0.05, -0.41 + i * 0.04, -0.39 + i * 0.04, 0.045, 8, L, 1.2)
            g.esfera(0, 0.05, -0.5, 0.045, 0.045, 0.045, L, 3, 8)
            for (const sx of [-1, 1]) g.ponta(sx * 0.04, 0.05, -0.47, 0.01, 0.01, sx * 0.07, 0.09, -0.56, Cc)
            g.caixa(-0.02, -0.13, -0.02, 0.02, 0.01, 0.04, Cc)
            g.caixa(-0.024, 0.0, 0.1, 0.024, 0.07, 0.24, B)
            boca = [0, 0.05, -0.52]; mira = 0.1
            break
        case "uivo":
            // o revólver: o tambor, o cano comprido e o cabo de madeira escura
            g.caixa(-0.024, 0.0, -0.12, 0.024, 0.075, 0.03, A)
            g.cano(0, 0.04, -0.075, -0.005, 0.036, 8, B)
            g.cano(0, 0.04, -0.045, -0.035, 0.038, 8, L, 1.6)
            g.cano(0, 0.052, -0.34, -0.1, 0.016, 8, Cc)
            g.caixa(-0.011, 0.064, -0.34, 0.011, 0.078, -0.1, A)
            g.caixa(-0.004, 0.078, -0.33, 0.004, 0.093, -0.32, L, 2)
            g.caixa(-0.006, 0.07, 0.02, 0.006, 0.1, 0.034, Cc)
            g.caixa(-0.019, -0.13, -0.005, 0.019, 0.01, 0.05, "#3b2618")
            g.caixa(-0.02, -0.1, 0.0, 0.02, -0.085, 0.052, L, 1.2)
            boca = [0, 0.052, -0.35]; mira = 0.09
            break
        case "ferrao":
            // o rifle de precisão: cano longo, freio de boca e a luneta
            g.caixa(-0.03, -0.005, -0.4, 0.03, 0.07, 0.12, A)
            g.cano(0, 0.035, -0.95, -0.38, 0.015, 8, Cc)
            g.cano(0, 0.035, -1.0, -0.93, 0.025, 8, B)
            g.caixa(-0.027, 0.0, -0.62, 0.027, 0.05, -0.38, B)
            g.cano(0, 0.13, -0.3, -0.02, 0.028, 10, Cc)
            g.cano(0, 0.13, -0.33, -0.29, 0.034, 10, A)
            g.cano(0, 0.13, -0.335, -0.33, 0.028, 10, L, 2.5)
            for (const z of [-0.24, -0.1]) g.caixa(-0.012, 0.07, z - 0.015, 0.012, 0.11, z + 0.015, Cc)
            g.caixa(-0.024, -0.03, 0.12, 0.024, 0.07, 0.36, B)
            g.caixa(-0.02, 0.07, 0.15, 0.02, 0.1, 0.3, A)
            g.caixa(-0.018, -0.14, 0.0, 0.018, 0.0, 0.05, Cc)
            g.caixa(-0.02, -0.1, -0.22, 0.02, 0.0, -0.13, Cc)
            g.caixa(-0.032, 0.02, -0.36, -0.028, 0.04, -0.05, L, 1.6)
            g.caixa(0.028, 0.02, -0.36, 0.032, 0.04, -0.05, L, 1.6)
            boca = [0, 0.035, -1.01]; mira = 0.13
            break
        case "fornalha":
            // o lança-chamas: o tanque embaixo, o bico com aletas e a chama-piloto
            g.caixa(-0.04, -0.01, -0.35, 0.04, 0.08, 0.1, A)
            g.cano(0, 0.04, -0.62, -0.33, 0.026, 8, Cc)
            g.cano(0, 0.04, -0.67, -0.6, 0.038, 8, B)
            for (let i = 0; i < 4; i++) g.cano(0, 0.04, -0.56 + i * 0.045, -0.545 + i * 0.045, 0.036, 8, L, 1.5)
            g.cano(0, -0.075, -0.32, 0.0, 0.05, 10, "#a8382a")
            g.cano(0, -0.075, -0.2, -0.17, 0.052, 10, "#2a2a30")
            g.esfera(0, 0.0, -0.66, 0.014, 0.014, 0.014, "#ff9a3a", 3, 6)
            g.caixa(-0.018, -0.15, 0.0, 0.018, 0.0, 0.05, Cc)
            g.caixa(-0.018, -0.17, -0.3, 0.018, -0.12, -0.25, Cc)
            g.caixa(-0.024, -0.02, 0.1, 0.024, 0.07, 0.28, B)
            boca = [0, 0.04, -0.68]; mira = 0.1
            break
        case "booper": {
            // a arma maravilha: branca e rosa, com orelhinhas de protogen, o
            // emissor em coração e, virada para quem segura, uma mini-viseira sorrindo
            const BR = "#f2eaf4", RS = "#ff7bd0", CO = "#ff4fb0"
            g.caixa(-0.04, -0.005, -0.3, 0.04, 0.085, 0.1, BR)
            for (const sx of [-1, 1]) {
                g.caixa(sx * 0.04 - 0.002, 0.02, -0.28, sx * 0.04 + 0.002, 0.06, -0.02, RS, 1.4)
                g.ponta(sx * 0.025, 0.083, -0.05, 0.014, 0.014, sx * 0.032, 0.15, -0.035, BR)
                g.ponta(sx * 0.025, 0.084, -0.058, 0.007, 0.004, sx * 0.03, 0.135, -0.05, RS, 1.2)
            }
            g.cano(0, 0.045, -0.46, -0.28, 0.03, 10, "#ffc6ea")
            for (let i = 0; i < 3; i++) g.cano(0, 0.045, -0.42 + i * 0.05, -0.41 + i * 0.05, 0.034, 10, RS, 1.3)
            g.esfera(-0.018, 0.058, -0.49, 0.022, 0.022, 0.016, CO, 2.4, 8)
            g.esfera(0.018, 0.058, -0.49, 0.022, 0.022, 0.016, CO, 2.4, 8)
            g.ponta(0, 0.05, -0.49, 0.036, 0.013, 0, 0.005, -0.49, CO, 2.4)
            g.caixa(-0.018, -0.13, -0.02, 0.018, 0.01, 0.04, "#d8c8e0")
            // a mini-viseira no tampo, de frente para quem segura: olhos ^ ^ e a boquinha
            g.caixa(-0.03, 0.085, 0.0, 0.03, 0.089, 0.07, "#0b0b10")
            for (const sx of [-1, 1]) {
                g.caixa(sx * 0.014 - 0.006, 0.089, 0.024, sx * 0.014 + 0.006, 0.091, 0.029, CO, 2.4)
                g.caixa(sx * 0.014 - 0.0025, 0.089, 0.019, sx * 0.014 + 0.0025, 0.091, 0.024, CO, 2.4)
            }
            g.caixa(-0.008, 0.089, 0.045, 0.008, 0.091, 0.049, CO, 2)
            boca = [0, 0.05, -0.51]; mira = 0.11
            break
        }
        case "nevasca":
            // o raio de gelo: dois cilindros de gás frio e o emissor com aletas
            g.caixa(-0.035, 0.0, -0.3, 0.035, 0.08, 0.1, A)
            for (const sx of [-1, 1]) {
                g.cano(sx * 0.052, 0.035, -0.28, -0.04, 0.024, 8, "#d8eef8")
                g.cano(sx * 0.052, 0.035, -0.24, -0.08, 0.025, 8, L, 1.3)
            }
            g.cano(0, 0.045, -0.5, -0.3, 0.02, 8, Cc)
            for (let i = 0; i < 4; i++) g.cano(0, 0.045, -0.48 + i * 0.045, -0.465 + i * 0.045, 0.042, 8, B)
            g.cano(0, 0.045, -0.56, -0.5, 0.012, 6, L, 2.6)
            g.caixa(-0.018, -0.13, -0.02, 0.018, 0.01, 0.04, Cc)
            g.caixa(-0.024, 0.0, 0.1, 0.024, 0.07, 0.26, B)
            boca = [0, 0.045, -0.57]; mira = 0.1
            break
    }
    // o nível em listras no corpo (1, 2 ou 3 traços)
    for (let i = 0; i < nivel; i++) g.caixa(0.031, 0.004, -0.05 + i * 0.022, 0.034, 0.012, -0.04 + i * 0.022, L, 2)
    return { geo: g, boca: boca, mira: mira, duasMaos: id !== "faisca" && id !== "uivo" }
}

const armasCache = {}
function arma(id, nivel) {
    const k = id + nivel
    return armasCache[k] || (armasCache[k] = geoArma(id, nivel))
}

/**
 * O braço da Protogen, nas cores do Bjorn: manga de pelo carvão eriçado,
 * bracelete com a faixa de LED violeta, tufos brancos no punho e a pata
 * fechada no cabo, com as garras de fora. No espaço da mão: o punho na
 * origem, o braço indo para +z (para trás, para fora da tela).
 */
const BJORN = { pelo: "#4a4a54", pelo2: "#5c5c68", branco: "#dcdce4", violeta: "#a83eff", pata: "#2a2a31", garra: "#ecebf3" }
function geoBraco(esquerdo) {
    const g = new Geo()
    const sx = esquerdo ? -1 : 1
    const B = BJORN
    g.caixa(-0.05, -0.058, 0.03, 0.05, 0.048, 0.32, B.pelo)
    // o bracelete e a faixa acesa
    g.caixa(-0.054, -0.062, 0.07, 0.054, 0.052, 0.2, "#1d1d23")
    g.caixa(-0.056, -0.064, 0.125, 0.056, 0.054, 0.152, B.violeta, 1.7)
    // tufos brancos saindo do bracelete, na direção da mão
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2
        const c = Math.cos(a), s2 = Math.sin(a)
        g.ponta(c * 0.04, s2 * 0.045 - 0.005, 0.07, 0.016, 0.016, c * 0.068, s2 * 0.068 - 0.005, 0.015, B.branco)
    }
    // a manga grossa de pelo, com tufos eriçados para trás
    g.caixa(-0.066, -0.076, 0.3, 0.066, 0.07, 0.62, B.pelo2)
    for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + 0.2
        const c = Math.cos(a), s2 = Math.sin(a)
        g.ponta(c * 0.055, s2 * 0.06, 0.3, 0.02, 0.02, c * 0.085, s2 * 0.09, 0.24, B.pelo2)
    }
    for (let i = 0; i < 4; i++) g.ponta(sx * 0.05, 0.02 - i * 0.025, 0.22 + i * 0.02, 0.012, 0.02, sx * 0.075, 0.03 - i * 0.025, 0.3 + i * 0.02, B.pelo)
    // a pata fechada no cabo: o dorso, os dedos e as garras
    g.caixa(-0.042, -0.065, -0.05, 0.042, 0.04, 0.035, B.pata)
    for (let i = 0; i < 4; i++) g.caixa(-0.044, -0.077 + i * 0.024, -0.074, 0.044, -0.056 + i * 0.024, -0.038, B.pelo)
    for (const x of [-0.03, -0.01, 0.01, 0.03]) g.ponta(x, -0.062, -0.074, 0.007, 0.006, x * 1.1, -0.095, -0.09, B.garra)
    g.caixa(-0.044 * sx - 0.013, -0.02, -0.045, -0.044 * sx + 0.013, 0.032, 0.0, B.pelo)
    g.ponta(-0.044 * sx, 0.03, -0.035, 0.007, 0.007, -0.046 * sx, 0.055, -0.06, B.garra)
    // o LED no dorso da pata
    g.caixa(-0.011, 0.04, -0.032, 0.011, 0.044, -0.008, B.violeta, 1.5)
    return g
}
const bracos = { D: null, E: null }
function braco(esq) {
    const k = esq ? "E" : "D"
    return bracos[k] || (bracos[k] = geoBraco(esq))
}

// ------------------------------------------------------------------ objetos do cenário

function geoCaixotes(semente) {
    const g = new Geo()
    const r = PZ.sorteio(semente)
    const cores = ["#4a4f5c", "#575d6b", "#3f4450"]
    const caixote = (x, y, z, w, h, d, c) => {
        g.caixa(x - w, y, z - d, x + w, y + h, z + d, c)
        g.caixa(x - w - 0.01, y + h * 0.42, z - d - 0.01, x + w + 0.01, y + h * 0.58, z + d + 0.01, "#c9a227")
        g.caixa(x - w * 0.6, y + h - 0.02, z - d * 0.6, x + w * 0.6, y + h + 0.01, z + d * 0.6, "#2d3039")
    }
    caixote(0.5 + (r() - 0.5) * 0.15, 0, 0.5 + (r() - 0.5) * 0.15, 0.48, 1.05, 0.48, cores[0])
    caixote(1.5 + (r() - 0.5) * 0.15, 0, 1.45 + (r() - 0.5) * 0.15, 0.46, 1.0, 0.46, cores[1])
    caixote(1.45, 0, 0.5, 0.45, 0.95, 0.45, cores[2])
    caixote(0.55, 0, 1.5, 0.44, 1.1, 0.44, cores[1])
    caixote(1.0 + (r() - 0.5) * 0.2, 1.05, 1.0 + (r() - 0.5) * 0.2, 0.5, 1.15, 0.5, cores[0])
    return g
}

function geoBancada() {
    const g = new Geo()
    g.caixa(0.1, 0.85, 0.1, 1.9, 0.95, 1.9, "#d4d9e3")
    g.caixa(0.15, 0, 0.15, 1.85, 0.85, 1.85, "#59607a")
    g.caixa(0.12, 0.05, 0.12, 1.88, 0.15, 1.88, "#2a2e3a")
    g.caixa(0.6, 0.95, 0.9, 1.4, 1.45, 0.98, "#1c1f28")
    g.caixa(0.64, 1.0, 0.885, 1.36, 1.4, 0.9, "#4af0ff", 1.3)
    g.caixa(0.95, 0.95, 0.98, 1.05, 1.15, 1.05, "#1c1f28")
    g.caixa(0.3, 0.95, 0.3, 0.55, 1.1, 0.55, "#c4ccdd")
    g.cilindro(1.6, 1.5, 0.95, 1.15, 0.06, 6, "#72e8a8", 0.8)
    return g
}

const CORES_TEMA = {
    lab: ["#c7ccd8", "#7e8598", "#62f3ff"], fabrica: ["#5c4b3c", "#3b3028", "#ffb347"], nucleo: ["#2c2338", "#18121f", "#d84bff"],
    estufa: ["#3e5a3a", "#253823", "#8dff5a"], gelo: ["#b9c8d8", "#7d8ea3", "#9fe8ff"]
}
function geoColuna(teto, tema) {
    const g = new Geo()
    const [c, d, l] = CORES_TEMA[tema] || CORES_TEMA.lab
    g.caixa(0.15, 0, 0.15, 1.85, teto, 1.85, c)
    g.caixa(0.05, 0, 0.05, 1.95, 0.35, 1.95, d)
    g.caixa(0.05, teto - 0.3, 0.05, 1.95, teto, 1.95, d)
    for (const [x, z] of [[1, 0.13], [1, 1.87], [0.13, 1], [1.87, 1]])
        g.caixa(x - 0.04, 0.6, z - 0.03, x + 0.04, teto - 0.6, z + 0.03, l, 1.5)
    return g
}

function geoCaixaGlitch() {
    // a base (a tampa é desenhada à parte, porque abre)
    const g = new Geo()
    g.caixa(0.15, 0, 0.55, 1.85, 0.8, 1.45, "#1e2230")
    g.caixa(0.12, 0.0, 0.52, 1.88, 0.08, 1.48, "#0f1118")
    for (const x of [0.2, 1.8]) g.caixa(x - 0.04, 0.1, 0.5, x + 0.04, 0.78, 0.54, "#62f3ff", 1.6)
    // o "?" de pixel na frente
    const px = [[0, 4], [1, 5], [2, 5], [3, 4], [3, 3], [2, 2], [2, 1], [2, -1]]
    for (const [i, j] of px) g.caixa(0.88 + (3 - i) * 0.07, 0.15 + j * 0.07 + 0.07, 0.535, 0.94 + (3 - i) * 0.07, 0.15 + j * 0.07 + 0.13, 0.55, "#62f3ff", 2)
    return g
}

function geoTampa() {
    const g = new Geo()
    g.caixa(-0.85, 0, -0.45, 0.85, 0.12, 0.45, "#262b3b")
    g.caixa(-0.75, 0.12, -0.35, 0.75, 0.14, 0.35, "#62f3ff", 1.2)
    return g
}

function geoForja() {
    const g = new Geo()
    g.caixa(0.2, 0, 0.3, 1.8, 0.9, 1.7, "#3a332f")
    g.caixa(0.15, 0.85, 0.25, 1.85, 1.0, 1.75, "#5d534c")
    g.caixa(0.25, 1.0, 1.2, 1.75, 2.2, 1.7, "#3a332f")
    g.caixa(0.4, 1.15, 1.15, 1.6, 2.0, 1.2, "#ff7a1a", 1.8)
    g.caixa(0.5, 1.0, 0.6, 1.5, 1.08, 1.0, "#1b1715")
    g.cilindro(1.0, 0.8, 1.08, 1.18, 0.25, 10, "#ff9a3a", 2.2)
    for (const x of [0.3, 1.7]) g.caixa(x - 0.06, 1.0, 0.35, x + 0.06, 1.9, 0.5, "#5d534c")
    g.caixa(0.24, 1.85, 0.35, 1.76, 1.95, 0.55, "#5d534c")
    return g
}

const COR_MODULO = { H: "#ff3b3b", B: "#3bff7a", T: "#ffe03b", O: "#d03bff", V: "#3b8bff", K: "#ff9a2a", J: "#e6e6ff" }

function geoModulo(letra) {
    const g = new Geo()
    const c = COR_MODULO[letra]
    g.caixa(0.35, 0, 0.55, 1.65, 2.3, 1.6, "#1d2029")
    g.caixa(0.45, 0.15, 0.5, 1.55, 2.15, 0.56, "#2a2f3c")
    g.caixa(0.55, 1.2, 0.49, 1.45, 2.0, 0.5, c, 1.6)
    g.caixa(0.55, 0.3, 0.49, 1.45, 0.45, 0.5, c, 1.0)
    // o símbolo de cada um, em preto sobre o painel aceso
    const s = (x0, y0, x1, y1) => g.caixa(x0, y0, 0.48, x1, y1, 0.49, "#0a0b0f")
    if (letra === "H") { s(0.93, 1.35, 1.07, 1.85); s(0.75, 1.53, 1.25, 1.67) }
    else if (letra === "B") { s(0.75, 1.4, 1.25, 1.5); s(0.75, 1.6, 1.25, 1.7); s(0.95, 1.4, 1.05, 1.85) }
    else if (letra === "T") { s(0.95, 1.6, 1.25, 1.9); s(0.8, 1.35, 1.1, 1.65) }
    else if (letra === "O") { s(0.75, 1.35, 1.25, 1.45); s(0.75, 1.75, 1.25, 1.85); s(0.75, 1.35, 0.85, 1.85); s(1.15, 1.35, 1.25, 1.85) }
    else if (letra === "V") { s(0.75, 1.45, 1.25, 1.55); s(0.75, 1.65, 1.25, 1.75); s(1.1, 1.4, 1.2, 1.8) }
    else if (letra === "K") { s(0.72, 1.4, 0.84, 1.85); s(0.94, 1.4, 1.06, 1.85); s(1.16, 1.4, 1.28, 1.85) }
    else if (letra === "J") {
        // duas presas
        for (const x of [0.88, 1.12]) for (let i = 0; i < 5; i++) s(x - 0.09 + i * 0.018, 1.85 - i * 0.09, x + 0.09 - i * 0.018, 1.9 - i * 0.09)
    }
    g.caixa(0.3, 2.3, 0.5, 1.7, 2.4, 1.65, "#2a2f3c")
    return g
}

function geoNucleo(teto) {
    const g = new Geo()
    g.cilindro(2, 2, 0, 0.6, 1.95, 8, "#1b1424")
    g.cilindro(2, 2, 0.6, teto - 0.6, 1.25, 8, "#c94bff", 2.2)
    for (let y = 1.2; y < teto - 1; y += 1.1) g.cilindro(2, 2, y, y + 0.25, 1.5, 8, "#2a2038")
    g.cilindro(2, 2, teto - 0.6, teto, 1.95, 8, "#1b1424")
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        g.caixa(2 + Math.cos(a) * 1.55 - 0.15, 0, 2 + Math.sin(a) * 1.55 - 0.15, 2 + Math.cos(a) * 1.55 + 0.15, teto, 2 + Math.sin(a) * 1.55 + 0.15, "#2a2038")
    }
    return g
}

/** O vaso da Estufa: terra, folhas mutantes que brilham e um cipó. */
function geoPlanta(semente) {
    const g = new Geo()
    const r = PZ.sorteio(semente)
    g.caixa(0.2, 0, 0.2, 1.8, 0.75, 1.8, "#4a3a2c")
    g.caixa(0.15, 0.7, 0.15, 1.85, 0.82, 1.85, "#5c4a38")
    g.caixa(0.25, 0.75, 0.25, 1.75, 0.8, 1.75, "#24180f")
    for (let i = 0; i < 9; i++) {
        const x = 0.4 + r() * 1.2, z = 0.4 + r() * 1.2, h = 0.6 + r() * 0.9
        const acesa = r() < 0.4
        g.ponta(x, 0.78, z, 0.05, 0.05, x + (r() - 0.5) * 0.5, 0.78 + h, z + (r() - 0.5) * 0.5, acesa ? "#7dff3a" : "#2f6b2a", acesa ? 1.2 : 0)
    }
    g.esfera(1, 1.05, 1, 0.16, 0.16, 0.16, "#b8ff4a", 1.6, 6)
    g.cilindro(1.0, 1.0, 0.8, 1.0, 0.04, 6, "#2f6b2a")
    return g
}

/** A cápsula criogênica: base, tubo de vidro com alguém congelado dentro e a tampa. */
function geoCapsula(teto) {
    const g = new Geo()
    g.cilindro(1, 1, 0, 0.35, 0.85, 10, "#3c4656")
    g.cilindro(1, 1, 0.35, 0.42, 0.8, 10, "#9fe8ff", 1.6)
    // quem dorme lá dentro: uma silhueta escura de orelhas pontudas
    g.caixa(0.82, 0.42, 0.86, 1.18, 1.55, 1.14, "#1b2530")
    g.caixa(0.86, 1.55, 0.88, 1.14, 1.85, 1.12, "#1b2530")
    for (const sx of [-1, 1]) g.ponta(1 + sx * 0.09, 1.85, 1, 0.04, 0.03, 1 + sx * 0.12, 2.0, 1.02, "#1b2530")
    g.caixa(0.9, 1.68, 0.86, 0.96, 1.72, 0.87, "#ff2b5e", 2.2)
    g.caixa(1.04, 1.68, 0.86, 1.1, 1.72, 0.87, "#ff2b5e", 2.2)
    // o vidro (claro, com um brilho frio) e a tampa
    g.cilindro(1, 1, 0.42, 2.45, 0.62, 10, "#9fc9dd", 0.25)
    g.cilindro(1, 1, 2.45, 2.8, 0.8, 10, "#3c4656")
    g.cilindro(1, 1, 2.62, 2.66, 0.82, 10, "#9fe8ff", 1.4)
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        g.caixa(1 + Math.cos(a) * 0.66 - 0.05, 0.4, 1 + Math.sin(a) * 0.66 - 0.05, 1 + Math.cos(a) * 0.66 + 0.05, 2.5, 1 + Math.sin(a) * 0.66 + 0.05, "#5a6578")
    }
    return g
}

/** O robozinho aliado: o mesmo do pé da Protogen no widget (corpo branco, viseira e LED violeta). */
function geoDrone() {
    const g = new Geo()
    g.esfera(0, 0, 0, 0.16, 0.14, 0.15, "#e6e6ee", 0, 10)
    g.caixa(-0.125, -0.055, -0.16, 0.125, 0.065, -0.095, "#0b0b10")
    g.caixa(-0.085, -0.01, -0.163, -0.03, 0.028, -0.158, "#b06bff", 2.6)
    g.caixa(0.03, -0.01, -0.163, 0.085, 0.028, -0.158, "#b06bff", 2.6)
    for (const sx of [-1, 1]) {
        g.ponta(sx * 0.08, 0.09, 0.0, 0.035, 0.03, sx * 0.11, 0.22, 0.03, "#e6e6ee")
        g.ponta(sx * 0.08, 0.1, -0.02, 0.015, 0.008, sx * 0.1, 0.19, 0.0, "#b06bff", 1.4)
    }
    g.cilindro(0, 0, -0.2, -0.12, 0.06, 8, "#3a3a44")
    g.cilindro(0, 0, -0.215, -0.2, 0.045, 8, "#b06bff", 2.6)
    return g
}

/** O Bjorn de pelúcia: um protogen sentadinho, carvão e branco, com o LED violeta. */
function geoPelucia() {
    const g = new Geo(), B = BJORN
    g.esfera(0, 0.17, 0, 0.17, 0.17, 0.15, B.pelo, 0, 8)
    g.esfera(0, 0.17, -0.1, 0.11, 0.12, 0.06, B.branco, 0, 8)
    for (const sx of [-1, 1]) {
        g.caixa(sx * 0.1 - 0.05, 0.0, -0.22, sx * 0.1 + 0.05, 0.08, -0.04, B.pelo)
        g.caixa(sx * 0.1 - 0.055, 0.0, -0.26, sx * 0.1 + 0.055, 0.09, -0.21, B.branco)
        g.caixa(sx * 0.17 - 0.04, 0.12, -0.07, sx * 0.17 + 0.04, 0.3, 0.04, B.pelo)
        g.ponta(sx * 0.1, 0.57, 0.02, 0.05, 0.04, sx * 0.15, 0.82, 0.04, B.pelo)
        g.ponta(sx * 0.1, 0.58, -0.02, 0.024, 0.01, sx * 0.135, 0.76, -0.01, B.violeta, 1.5)
        g.caixa(sx * 0.07 - 0.03, 0.45, -0.203, sx * 0.07 + 0.03, 0.49, -0.199, B.violeta, 2.6)
    }
    g.caixa(-0.16, 0.32, -0.14, 0.16, 0.58, 0.14, B.pelo)
    g.caixa(-0.14, 0.36, -0.2, 0.14, 0.54, -0.12, "#0b0b10")
    g.caixa(-0.1, 0.36, -0.25, 0.1, 0.47, -0.18, "#0b0b10")
    g.caixa(-0.05, 0.39, -0.253, 0.05, 0.405, -0.25, B.violeta, 2)
    g.ponta(0.03, 0.58, 0.0, 0.04, 0.04, 0.1, 0.68, -0.09, B.violeta, 0.6)
    g.caixa(-0.04, 0.03, 0.12, 0.04, 0.1, 0.34, B.pelo)
    g.caixa(-0.035, 0.035, 0.3, 0.035, 0.095, 0.36, B.branco)
    return g
}

/** A pedra de gelo do Urso. */
function geoPedra() {
    const g = new Geo()
    g.esfera(0, 0, 0, 0.42, 0.36, 0.4, "#bfe2f5", 0.35, 6)
    for (const [x, y, z, tx, ty, tz] of [[0.2, 0.15, 0, 0.5, 0.4, 0.1], [-0.2, 0.1, 0.1, -0.5, 0.35, 0.2], [0, -0.1, -0.2, 0.1, -0.4, -0.5], [0.05, 0.2, 0.2, 0.0, 0.55, 0.35]])
        g.ponta(x, y, z, 0.1, 0.1, tx, ty, tz, "#e6f8ff", 0.8)
    return g
}

function geoLuminaria(cor) {
    const g = new Geo()
    g.caixa(-0.5, -0.12, -0.18, 0.5, 0, 0.18, "#2a2d36")
    g.caixa(-0.45, -0.14, -0.12, 0.45, -0.11, 0.12, cor, 2.5)
    return g
}

function geoPortal(cor) {
    const g = new Geo()
    g.anel(0, 0.012, 0, 0.55, 0.78, 16, "#16121a")
    g.anel(0, 0.015, 0, 0.62, 0.7, 16, cor, 2)
    g.anel(0, 0.012, 0, 0, 0.5, 12, "#0a080c")
    return g
}

function geoMolduraParede(cor) {
    // na parede, olhando para +z (gira depois), centro na origem
    const g = new Geo()
    g.caixa(-0.7, -0.5, 0, 0.7, 0.5, 0.04, "#1c1f28")
    g.caixa(-0.7, 0.44, 0.04, 0.7, 0.5, 0.06, cor, 1.8)
    g.caixa(-0.7, -0.5, 0.04, 0.7, -0.44, 0.06, cor, 1.8)
    g.caixa(-0.7, -0.5, 0.04, -0.64, 0.5, 0.06, cor, 1.8)
    g.caixa(0.64, -0.5, 0.04, 0.7, 0.5, 0.06, cor, 1.8)
    return g
}

function geoPorta(teto, larg) {
    // uma folha de porta para um ladrilho, no eixo x (gira para o outro)
    const g = new Geo()
    const w = larg / 2
    g.caixa(-w, 0, -0.18, w, teto, 0.18, "#4d5260")
    g.caixa(-w + 0.08, 0.1, -0.2, w - 0.08, 1.0, 0.2, "#c9a227")
    for (let i = 0; i < 4; i++) g.caixa(-w + 0.15 + i * 0.45, 0.12, -0.21, -w + 0.35 + i * 0.45, 0.98, 0.21, "#1d1f24")
    g.caixa(-w, 1.15, -0.21, w, 1.25, 0.21, "#ff3b5c", 1.6)
    g.caixa(-w + 0.3, 1.5, -0.2, w - 0.3, teto - 0.3, 0.2, "#3b3f4c")
    return g
}

PZ.M4 = M4
PZ.cadeia = cadeia
PZ.Geo = Geo
PZ.cor = cor
PZ.Modelos = {
    modelo: modelo, matrizes: matrizes, pose: pose, coresDe: coresDe, arma: arma, braco: braco,
    caixotes: geoCaixotes, bancada: geoBancada, coluna: geoColuna, caixaGlitch: geoCaixaGlitch,
    planta: geoPlanta, capsula: geoCapsula, drone: geoDrone, pedra: geoPedra, pelucia: geoPelucia, CORES_TEMA: CORES_TEMA,
    tampa: geoTampa, forja: geoForja, modulo: geoModulo, nucleo: geoNucleo, luminaria: geoLuminaria,
    portal: geoPortal, moldura: geoMolduraParede, porta: geoPorta,
    BRILHO_NIVEL: BRILHO_NIVEL, COR_MODULO: COR_MODULO
}

})(typeof window !== "undefined" ? (window.PZ = window.PZ || {}) : (globalThis.PZ = globalThis.PZ || {}))
