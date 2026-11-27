/*
 * Protocolo Z — o som. Tudo sintetizado na hora (Web Audio): nenhum arquivo,
 * nada da rede. O que acontece longe soa mais baixo e do lado certo.
 */
(function (PZ) {
"use strict"

let ac = null, mestre = null, efeitos = null, musica = null, ruidoBuf = null
let volume = 0.8
const ouvinte = { x: 0, y: 0, z: 0, yaw: 0 }
let drone = null

function iniciar() {
    try {
        if (!ac) {
            ac = new (window.AudioContext || window.webkitAudioContext)()
            const comp = ac.createDynamicsCompressor()
            comp.threshold.value = -14
            comp.ratio.value = 4
            mestre = ac.createGain()
            mestre.gain.value = volume
            mestre.connect(comp).connect(ac.destination)
            efeitos = ac.createGain()
            efeitos.connect(mestre)
            musica = ac.createGain()
            musica.gain.value = 0.5
            musica.connect(mestre)
            ruidoBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
            const d = ruidoBuf.getChannelData(0)
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
        }
        if (ac.state === "suspended") ac.resume()
    } catch (e) { ac = null }
}

function definirVolume(v) {
    volume = v
    if (mestre) mestre.gain.setTargetAtTime(v, ac.currentTime, 0.05)
}

/** Para onde vai o som: volume pela distância e o lado pelo ângulo. */
function espacial(p) {
    if (!p) return { vol: 1, pan: 0 }
    const dx = p[0] - ouvinte.x, dz = p[2] - ouvinte.z
    const d = Math.hypot(dx, dz, (p[1] || 0) - ouvinte.y)
    const vol = Math.max(0, Math.min(1, 1 / (1 + d * d * 0.012))) * (d > 45 ? 0 : 1)
    const rx = Math.cos(ouvinte.yaw), rz = Math.sin(ouvinte.yaw)
    const pan = d > 0.5 ? Math.max(-0.9, Math.min(0.9, (dx * rx + dz * rz) / d)) : 0
    return { vol: vol, pan: pan }
}

function saida(pan, destino) {
    if (!pan || !ac.createStereoPanner) return destino || efeitos
    const p = ac.createStereoPanner()
    p.pan.value = pan
    p.connect(destino || efeitos)
    return p
}

function ruido(dur, freq, vol, o) {
    if (!ac || vol <= 0.001) return
    o = o || {}
    const t = ac.currentTime + (o.atraso || 0)
    const src = ac.createBufferSource()
    src.buffer = ruidoBuf
    const f = ac.createBiquadFilter()
    f.type = o.tipo || "lowpass"
    f.frequency.setValueAtTime(freq, t)
    if (o.fim) f.frequency.exponentialRampToValueAtTime(o.fim, t + dur)
    f.Q.value = o.q || 0.7
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + (o.ataque || 0.004))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(saida(o.pan, o.destino))
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
}

function tom(freq, dur, vol, tipo, fim, o) {
    if (!ac || vol <= 0.001) return
    o = o || {}
    const t = ac.currentTime + (o.atraso || 0)
    const osc = ac.createOscillator()
    osc.type = tipo || "sine"
    osc.frequency.setValueAtTime(freq, t)
    if (fim) osc.frequency.exponentialRampToValueAtTime(fim, t + dur)
    if (o.vibrato) {
        const lfo = ac.createOscillator(), lg = ac.createGain()
        lfo.frequency.value = o.vibrato
        lg.gain.value = freq * 0.04
        lfo.connect(lg).connect(osc.frequency)
        lfo.start(t); lfo.stop(t + dur + 0.05)
    }
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + (o.ataque || 0.005))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    let no = osc
    if (o.filtro) {
        const f = ac.createBiquadFilter()
        f.type = "lowpass"
        f.frequency.value = o.filtro
        no = osc.connect(f)
    }
    no.connect(g).connect(saida(o.pan, o.destino))
    osc.start(t)
    osc.stop(t + dur + 0.05)
}

// ------------------------------------------------------------------ os sons

const ARMA = {
    faisca(n) { ruido(0.12, 3000, 0.4, { tipo: "bandpass", q: 0.8 }); tom(900, 0.09, 0.22, "square", 160); tom(140, 0.12, 0.35, "sine", 50); if (n > 1) tom(2400, 0.12, 0.08, "sine", 1200) },
    enxame(n) { ruido(0.08, 2600, 0.32, { tipo: "bandpass", q: 1 }); tom(600, 0.06, 0.13, "square", 140); tom(120, 0.08, 0.25, "sine", 50); if (n > 1) tom(2000, 0.07, 0.05, "sine", 900) },
    estilhaco(n) { ruido(0.35, 1400, 0.65, { fim: 200 }); ruido(0.1, 4000, 0.3, { tipo: "highpass" }); tom(90, 0.3, 0.6, "sine", 35); ruido(0.08, 900, 0.18, { atraso: 0.38, tipo: "bandpass", q: 3 }); ruido(0.08, 700, 0.18, { atraso: 0.5, tipo: "bandpass", q: 3 }); if (n > 1) tom(1600, 0.25, 0.07, "sawtooth", 400) },
    lanca(n) { ruido(0.12, 2000, 0.45, { tipo: "bandpass", q: 0.9 }); tom(420, 0.08, 0.15, "sawtooth", 110); tom(110, 0.12, 0.4, "sine", 45); if (n > 1) tom(2600, 0.1, 0.05, "sine", 1300) },
    tempestade(n) { ruido(0.1, 1700, 0.42, { tipo: "bandpass", q: 0.9 }); tom(300, 0.08, 0.16, "sawtooth", 90); tom(95, 0.1, 0.4, "sine", 40); if (n > 1) tom(1800, 0.08, 0.05, "sine", 900) },
    gama(n) { tom(1800, 0.45, 0.25, "sawtooth", 80, { filtro: 3000 }); tom(220, 0.5, 0.35, "square", 40, { filtro: 900 }); ruido(0.4, 6000, 0.25, { tipo: "highpass" }); if (n > 1) tom(3200, 0.4, 0.08, "sine", 900) },
    supernova() { ruido(0.25, 600, 0.45, { fim: 120 }); tom(160, 0.3, 0.45, "sine", 50); tom(520, 0.2, 0.12, "triangle", 900) },
    tesla() { for (let i = 0; i < 6; i++) tom(300 + Math.random() * 2000, 0.05, 0.12, "square", 100 + Math.random() * 300, { atraso: i * 0.03 }); ruido(0.4, 5000, 0.35, { tipo: "highpass" }); tom(70, 0.4, 0.35, "sawtooth", 40, { filtro: 400 }) },
    // o revólver: um estouro grave e o eco
    uivo(n) { ruido(0.3, 1800, 0.7, { fim: 300 }); tom(110, 0.35, 0.6, "sine", 38); ruido(0.5, 700, 0.18, { atraso: 0.12, fim: 200 }); if (n > 1) tom(1400, 0.2, 0.07, "sawtooth", 500) },
    // o rifle: o estalo seco e o eco comprido
    ferrao(n) { ruido(0.12, 5000, 0.7, { tipo: "highpass" }); tom(140, 0.45, 0.6, "sine", 35); ruido(1.0, 900, 0.22, { atraso: 0.1, fim: 120 }); if (n > 1) tom(2200, 0.3, 0.07, "sine", 700) },
    // a Fornalha: um sopro de fogo curto a cada jato (vira um ronco contínuo)
    fornalha() { ruido(0.1, 700, 0.16, { tipo: "bandpass", q: 0.6 }); if (Math.random() < 0.3) ruido(0.06, 2500, 0.05, { tipo: "highpass" }) },
    // o Booper: um "piu" redondo
    booper(n) { tom(1300, 0.18, 0.22, "sine", 650); tom(1950, 0.12, 0.08, "triangle", 900, { atraso: 0.02 }); if (n > 1) tom(2600, 0.15, 0.05, "sine", 1300) },
    // a Nevasca: o chiado frio
    nevasca() { ruido(0.09, 6500, 0.12, { tipo: "highpass" }); tom(1700 + Math.random() * 300, 0.07, 0.04, "sine", 2600) }
}

const S = {
    tiro(id, nivel) { (ARMA[id] || ARMA.faisca)(nivel || 1) },
    vazio() { tom(1800, 0.03, 0.15, "square", 1200); ruido(0.03, 3000, 0.1, { tipo: "highpass" }) },
    recarga(id) {
        const longa = id === "tempestade" || id === "gama" || id === "estilhaco"
        ruido(0.06, 1500, 0.22, { tipo: "bandpass", q: 4 })
        ruido(0.05, 900, 0.18, { tipo: "bandpass", q: 5, atraso: 0.12 })
        ruido(0.07, 1200, 0.25, { tipo: "bandpass", q: 4, atraso: longa ? 1.2 : 0.7 })
        tom(500, 0.05, 0.08, "square", 700, { atraso: longa ? 1.2 : 0.7 })
    },
    recarregou() { ruido(0.05, 2200, 0.25, { tipo: "bandpass", q: 6 }); tom(1100, 0.04, 0.08, "square", 900) },
    troca() { ruido(0.08, 1300, 0.15, { tipo: "bandpass", q: 3 }); ruido(0.05, 2000, 0.12, { tipo: "bandpass", q: 4, atraso: 0.22 }) },
    acerto(cabeca, morte) {
        tom(cabeca ? 1900 : 1500, 0.05, 0.16, "square", cabeca ? 2400 : 1300)
        if (cabeca) tom(2800, 0.12, 0.09, "sine")
        if (morte) { tom(500, 0.12, 0.1, "square", 200); ruido(0.1, 3000, 0.1, { tipo: "bandpass", q: 2 }) }
    },
    morreu(p, tipo) {
        const s = espacial(p)
        for (let i = 0; i < 5; i++) tom(200 + Math.random() * 900, 0.06, 0.18 * s.vol, "square", 80 + Math.random() * 200, { atraso: i * 0.045, pan: s.pan })
        ruido(0.3, 900, 0.3 * s.vol, { fim: 200, pan: s.pan })
        if (tipo === "brutamonte" || tipo === "lobo" || tipo === "gosma" || tipo === "urso") tom(80, 0.8, 0.5 * s.vol, "sawtooth", 30, { filtro: 300, pan: s.pan })
    },
    grunhido(p, tipo) {
        const s = espacial(p)
        if (s.vol < 0.02) return
        const base = { corredor: 150, cuspidor: 120, brutamonte: 55, omega: 42, bomba: 100, saltador: 170, uivador: 95,
                       lobo: 60, gosma: 48, urso: 45 }[tipo] || 85
        // no Modo Cabeçudo, a voz fica fininha
        const f = base * (0.85 + Math.random() * 0.3) * (PZ.segredos && PZ.segredos.cabecudo ? 1.9 : 1)
        tom(f, 0.6 + Math.random() * 0.4, 0.2 * s.vol, "sawtooth", f * 0.7, { filtro: 700, vibrato: 9 + Math.random() * 8, pan: s.pan })
        ruido(0.5, 500, 0.12 * s.vol, { tipo: "bandpass", q: 3, pan: s.pan })
        // o glitch na voz
        if (Math.random() < 0.6) tom(f * 4, 0.08, 0.07 * s.vol, "square", f * 2, { atraso: 0.2, pan: s.pan })
    },
    ataque(p) { const s = espacial(p); ruido(0.25, 1800, 0.35 * s.vol, { tipo: "bandpass", q: 1, fim: 500, pan: s.pan }) },
    surge(p) { const s = espacial(p); ruido(0.7, 300, 0.25 * s.vol, { ataque: 0.2, fim: 1200, pan: s.pan }); tom(60, 0.7, 0.2 * s.vol, "sawtooth", 120, { filtro: 400, pan: s.pan }) },
    rugido(p) { const s = espacial(p); tom(70, 1.1, 0.55 * Math.max(0.3, s.vol), "sawtooth", 45, { filtro: 600, vibrato: 14, pan: s.pan }); ruido(1.0, 700, 0.35 * Math.max(0.3, s.vol), { tipo: "bandpass", q: 2, pan: s.pan }) },
    pavio(p) { const s = espacial(p); for (let i = 0; i < 5; i++) tom(1400 + i * 200, 0.06, 0.18 * s.vol, "square", null, { atraso: i * 0.13, pan: s.pan }) },
    cuspe(p) { const s = espacial(p); ruido(0.25, 900, 0.35 * s.vol, { tipo: "bandpass", q: 2, fim: 2400, pan: s.pan }); tom(300, 0.2, 0.12 * s.vol, "triangle", 700, { pan: s.pan }) },
    respingo(p) { const s = espacial(p); ruido(0.2, 1200, 0.3 * s.vol, { pan: s.pan }) },
    explosao(p, grande) {
        const s = espacial(p), v = Math.max(0.35, s.vol)
        ruido(grande ? 1.6 : 1.1, 1500, 0.9 * v, { fim: 80, pan: s.pan * 0.5 })
        tom(70, 0.8, 0.8 * v, "sine", 25, { pan: s.pan * 0.5 })
        ruido(0.15, 5000, 0.3 * v, { tipo: "highpass" })
    },
    atomica() {
        tom(40, 2.6, 1, "sine", 22)
        ruido(2.8, 2500, 1, { fim: 60, ataque: 0.02 })
        ruido(0.4, 7000, 0.4, { tipo: "highpass" })
        tom(900, 1.8, 0.15, "sawtooth", 50, { filtro: 1500, atraso: 0.1 })
    },
    bloqueio() { tom(1400, 0.15, 0.2, "sine", 2200); ruido(0.12, 5000, 0.15, { tipo: "highpass" }) },
    escudo() { tom(300, 0.6, 0.2, "sine", 900); tom(450, 0.6, 0.12, "sine", 1350, { atraso: 0.05 }) },
    gelo() { for (let i = 0; i < 6; i++) tom(2000 + i * 330, 0.3, 0.07, "sine", null, { atraso: i * 0.05 }); ruido(0.5, 6000, 0.15, { tipo: "highpass" }) },
    furia() { tom(110, 0.6, 0.35, "sawtooth", 220, { filtro: 900 }); tom(165, 0.6, 0.25, "sawtooth", 330, { filtro: 900 }) },
    emp() { tom(80, 1.2, 0.6, "sine", 30); tom(1200, 1.0, 0.2, "sawtooth", 60, { filtro: 2000 }); ruido(1.2, 3000, 0.4, { fim: 100 }) },
    pisao(p) { const s = espacial(p); tom(45, 0.9, 0.9, "sine", 25); ruido(0.8, 400, 0.7 * Math.max(0.4, s.vol), { fim: 60 }) },
    pancada(p) { const s = espacial(p); tom(60, 0.4, 0.6 * s.vol, "sine", 30); ruido(0.3, 800, 0.4 * s.vol) },
    dano() { tom(140, 0.18, 0.4, "sine", 60); ruido(0.15, 1200, 0.3); tom(2400 + Math.random() * 800, 0.05, 0.07, "square", 600, { atraso: 0.04 }) },
    passo(correndo) { ruido(0.07, correndo ? 700 : 500, correndo ? 0.14 : 0.09, { tipo: "bandpass", q: 1.5 }) },
    pulo() { ruido(0.08, 600, 0.08) },
    aterrissa() { ruido(0.12, 400, 0.22); tom(80, 0.1, 0.15, "sine", 50) },
    compra() { [1046, 1318, 1568, 2093].forEach((f, i) => tom(f, 0.12, 0.13, "square", null, { atraso: i * 0.05, filtro: 4000 })) },
    semPontos() { tom(140, 0.25, 0.25, "square", 110, { filtro: 900 }); tom(147, 0.25, 0.2, "square", 116, { filtro: 900 }) },
    porta() { ruido(1.1, 1800, 0.3, { tipo: "bandpass", q: 0.7, ataque: 0.05 }); tom(70, 1.0, 0.3, "sawtooth", 140, { filtro: 300 }); ruido(0.2, 500, 0.45, { atraso: 1.0 }) },
    caixa() {
        // uma caixinha de música (glitch): sobe e desce enquanto as armas giram
        const notas = [659, 784, 988, 1175, 988, 784, 659, 523, 659, 784, 988, 1319, 1175, 988, 784, 880]
        notas.forEach((f, i) => { tom(f, 0.22, 0.09, "triangle", null, { atraso: i * 0.18, destino: musica }); if (i % 4 === 0) tom(f / 4, 0.4, 0.07, "sine", null, { atraso: i * 0.18, destino: musica }) })
    },
    caixaPronta() { tom(1568, 0.3, 0.12, "triangle"); tom(2093, 0.4, 0.1, "triangle", null, { atraso: 0.1 }) },
    forja() { for (let i = 0; i < 4; i++) { ruido(0.15, 3200, 0.35, { tipo: "bandpass", q: 6, atraso: i * 0.5 }); tom(880 + i * 40, 0.4, 0.12, "triangle", null, { atraso: i * 0.5 }) } tom(60, 2.2, 0.25, "sawtooth", 90, { filtro: 300 }) },
    forjada() { [523, 659, 784, 1046, 1318].forEach((f, i) => tom(f, 0.3, 0.12, "triangle", null, { atraso: i * 0.07 })); ruido(0.4, 5000, 0.15, { tipo: "highpass" }) },
    modulo() { [392, 523, 659, 784].forEach((f, i) => tom(f, 0.35, 0.12, "square", null, { atraso: i * 0.09, filtro: 2500 })); ruido(0.5, 800, 0.2, { tipo: "bandpass", q: 1 }) },
    poder() { [784, 988, 1175, 1568, 1976].forEach((f, i) => tom(f, 0.2, 0.13, "square", null, { atraso: i * 0.06, filtro: 5000 })) },
    poderSurge(p) { const s = espacial(p); tom(1200, 0.5, 0.12 * s.vol, "sine", 2400, { pan: s.pan }); tom(1800, 0.5, 0.06 * s.vol, "sine", 3600, { pan: s.pan, atraso: 0.1 }) },
    poderFim() { tom(900, 0.3, 0.1, "triangle", 400) },
    onda(especial) {
        const base = especial ? 98 : 110
        tom(base, 2.5, 0.3, "sawtooth", base * 0.98, { filtro: 500, destino: musica })
        tom(base * 1.19, 2.5, 0.2, "sawtooth", null, { filtro: 500, destino: musica })
        tom(base * 1.5, 2.5, 0.18, "sawtooth", null, { filtro: 600, destino: musica })
        ruido(1.5, 200, 0.5, { fim: 60, destino: musica })
        for (let i = 0; i < 3; i++) tom(55, 0.5, 0.5, "sine", 35, { atraso: 0.6 + i * 0.5, destino: musica })
    },
    fimOnda() {
        [523, 494, 440, 392, 330].forEach((f, i) => tom(f, 0.5, 0.11, "triangle", null, { atraso: i * 0.22, destino: musica }))
        tom(130, 1.6, 0.2, "sawtooth", 65, { filtro: 400, destino: musica })
    },
    vitoria() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tom(f, 0.4, 0.13, "square", null, { atraso: i * 0.16, filtro: 3000, destino: musica })) },
    granada() { ruido(0.15, 800, 0.15, { tipo: "bandpass" }); tom(500, 0.05, 0.08, "square", 1000) },
    quica(p) { const s = espacial(p); tom(900, 0.04, 0.12 * s.vol, "square", 700, { pan: s.pan }) },
    garra() { ruido(0.18, 2500, 0.3, { tipo: "bandpass", q: 1.2, fim: 800 }) },
    golpe(acertou) { if (acertou) { tom(120, 0.15, 0.5, "sine", 50); ruido(0.12, 1500, 0.4) } },
    reiniciando() { [880, 660, 440, 330].forEach((f, i) => tom(f, 0.3, 0.15, "square", null, { atraso: i * 0.25, filtro: 2000 })) },
    reiniciou() { [330, 440, 660, 880, 1320].forEach((f, i) => tom(f, 0.2, 0.15, "square", null, { atraso: i * 0.08, filtro: 3000 })); tom(60, 0.8, 0.5, "sine", 30) },
    morte() { tom(400, 1.8, 0.3, "sawtooth", 40, { filtro: 1200 }); for (let i = 0; i < 8; i++) tom(100 + Math.random() * 3000, 0.08, 0.1, "square", null, { atraso: 0.2 + i * 0.1 }) },
    coracao() { tom(60, 0.15, 0.35, "sine", 40); tom(55, 0.15, 0.25, "sine", 40, { atraso: 0.22 }) },
    menu() { tom(1200, 0.05, 0.08, "square", 1500, { filtro: 4000 }) },
    msg() { tom(660, 0.12, 0.08, "square", null, { filtro: 3000 }); tom(990, 0.15, 0.08, "square", null, { atraso: 0.08, filtro: 3000 }) },
    // o Uivo da Protogen: sobe, segura e treme (sintetizado, com o glitch da viseira)
    uivo() {
        tom(220, 1.6, 0.35, "sawtooth", 440, { filtro: 1800, vibrato: 6, ataque: 0.15 })
        tom(330, 1.6, 0.22, "triangle", 660, { vibrato: 6, ataque: 0.15 })
        tom(110, 1.2, 0.3, "sine", 70)
        for (let i = 0; i < 5; i++) tom(1800 + i * 300, 0.06, 0.05, "square", null, { atraso: 0.3 + i * 0.12 })
    },
    uivoMonstro(p) {
        const s = espacial(p)
        if (s.vol < 0.02) return
        tom(260, 1.3, 0.3 * s.vol, "sawtooth", 520, { filtro: 1200, vibrato: 7, ataque: 0.2, pan: s.pan })
        tom(390, 1.3, 0.14 * s.vol, "triangle", 700, { vibrato: 7, ataque: 0.2, pan: s.pan })
    },
    salto(p, grande) { const s = espacial(p); ruido(0.3, grande ? 600 : 1400, (grande ? 0.5 : 0.25) * s.vol, { tipo: "bandpass", q: 1, fim: 300, pan: s.pan }); if (grande) tom(90, 0.5, 0.4 * s.vol, "sawtooth", 50, { filtro: 500, pan: s.pan }) },
    aterrissou(p) { const s = espacial(p); ruido(0.15, 500, 0.3 * s.vol, { pan: s.pan }); tom(90, 0.12, 0.2 * s.vol, "sine", 50, { pan: s.pan }) },
    droneTiro(p) { const s = espacial(p); tom(1500, 0.06, 0.08 * Math.max(0.4, s.vol), "square", 600, { pan: s.pan, filtro: 4000 }) },
    choque(p) { const s = espacial(p); for (let i = 0; i < 4; i++) tom(500 + Math.random() * 1500, 0.05, 0.1 * s.vol, "square", 200, { atraso: i * 0.03, pan: s.pan }); ruido(0.25, 5000, 0.2 * s.vol, { tipo: "highpass", pan: s.pan }) },
    fogo(p) { const s = espacial(p); ruido(0.5, 900, 0.3 * s.vol, { tipo: "bandpass", q: 0.7, ataque: 0.05, pan: s.pan }) },
    congelou(p) { const s = espacial(p); for (let i = 0; i < 4; i++) tom(2400 + i * 400, 0.15, 0.06 * s.vol, "sine", null, { atraso: i * 0.03, pan: s.pan }); ruido(0.2, 7000, 0.15 * s.vol, { tipo: "highpass", pan: s.pan }) },
    estilhaco(p) { const s = espacial(p); ruido(0.4, 6000, 0.45 * Math.max(0.3, s.vol), { tipo: "highpass", pan: s.pan }); for (let i = 0; i < 6; i++) tom(2000 + Math.random() * 3000, 0.08, 0.06 * s.vol, "sine", null, { atraso: i * 0.04, pan: s.pan }); tom(80, 0.3, 0.4 * s.vol, "sine", 40, { pan: s.pan }) },
    poca(p) { const s = espacial(p); ruido(0.6, 3000, 0.2 * s.vol, { tipo: "bandpass", q: 2, fim: 1200, pan: s.pan }) },
    arremesso(p) { const s = espacial(p); ruido(0.4, 400, 0.35 * Math.max(0.3, s.vol), { tipo: "bandpass", q: 1, fim: 1200, pan: s.pan }); tom(70, 0.5, 0.35 * Math.max(0.3, s.vol), "sawtooth", 45, { filtro: 400, pan: s.pan }) },
    // ---- os segredos
    boop(p, garra) {
        const s = espacial(p), v = Math.max(0.35, s.vol)
        tom(garra ? 520 : 420, 0.16, 0.3 * v, "sine", garra ? 1500 : 1200, { pan: s.pan })
        tom(garra ? 1800 : 1500, 0.08, 0.08 * v, "triangle", 2400, { atraso: 0.09, pan: s.pan })
    },
    coracao(p) { const s = espacial(p); tom(900, 0.12, 0.12 * s.vol, "sine", 1500, { pan: s.pan }); ruido(0.1, 6000, 0.06 * s.vol, { tipo: "highpass", pan: s.pan }) },
    // o bip-bip do robozinho escondido (mais alto quanto mais perto)
    bipe(p) { const s = espacial(p); if (s.vol < 0.05) return; tom(1800, 0.06, 0.12 * s.vol, "sine", null, { pan: s.pan }); tom(2300, 0.06, 0.1 * s.vol, "sine", null, { atraso: 0.11, pan: s.pan }) },
    achou(n) { [1047, 1319, 1568, 2093].slice(0, n + 1).forEach((f, i) => tom(f, 0.25, 0.14, "triangle", null, { atraso: i * 0.08 })); tom(523, 0.4, 0.08, "sine", null, { atraso: 0.05 }) },
    // o apertão na pelúcia
    pelucia() { tom(700, 0.15, 0.22, "sine", 1400); tom(800, 0.18, 0.2, "sine", 1600, { atraso: 0.18 }) },
    konami() { [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tom(f, 0.12, 0.12, "square", null, { atraso: i * 0.055, filtro: 4500 })); tom(2093, 0.5, 0.1, "triangle", null, { atraso: 0.4 }) },
    conquista() { tom(1319, 0.2, 0.12, "triangle"); tom(1760, 0.35, 0.12, "triangle", null, { atraso: 0.12 }); tom(2637, 0.4, 0.05, "sine", null, { atraso: 0.12 }) },
    /**
     * A música secreta (os 3 robozinhos): "A Matilha Dança", um chiptune em
     * mi menor, 150 bpm, 8 compassos — o tempo da festa.
     */
    musicaSecreta() {
        if (!ac) return
        const c = 60 / 150 / 2        // uma colcheia
        const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)
        // a melodia: [nota MIDI, colcheias]
        const mel = [[76, 1], [76, 1], [79, 1], [76, 1], [83, 1], [81, 1], [79, 1], [78, 1],
                     [76, 2], [74, 1], [76, 1], [79, 2], [76, 2],
                     [76, 1], [76, 1], [79, 1], [76, 1], [83, 1], [81, 1], [79, 1], [78, 1],
                     [81, 1], [79, 1], [78, 1], [74, 1], [76, 4],
                     [84, 1], [83, 1], [81, 1], [79, 1], [81, 1], [83, 1], [84, 1], [86, 1],
                     [83, 2], [79, 2], [76, 2], [79, 1], [81, 1],
                     [84, 1], [83, 1], [81, 1], [79, 1], [78, 1], [79, 1], [81, 1], [83, 1],
                     [88, 4], [83, 1], [79, 1], [76, 2]]
        let t = 0.15
        for (const [m, d] of mel) {
            tom(hz(m), d * c * 0.95, 0.09, "square", null, { atraso: t, destino: musica, filtro: 3200 })
            tom(hz(m + 12), d * c * 0.6, 0.025, "triangle", null, { atraso: t, destino: musica })
            t += d * c
        }
        // o baixo pulando oitava, e a bateria
        const raiz = [40, 36, 40, 38, 45, 40, 45, 40]
        for (let b = 0; b < 8; b++)
            for (let k = 0; k < 8; k++) {
                const at = 0.15 + (b * 8 + k) * c
                tom(hz(raiz[b] + (k % 2 ? 12 : 0)), c * 0.8, 0.12, "sawtooth", null, { atraso: at, destino: musica, filtro: 700 })
                ruido(0.03, 9000, 0.04, { tipo: "highpass", atraso: at, destino: musica })
                if (k % 4 === 0) { tom(110, 0.12, 0.3, "sine", 45, { atraso: at, destino: musica }) }
                if (k % 4 === 2) ruido(0.12, 1800, 0.14, { tipo: "bandpass", q: 0.8, atraso: at, destino: musica })
            }
        tom(hz(64), 0.9, 0.08, "square", null, { atraso: t, destino: musica, filtro: 2500 })
        tom(hz(52), 0.9, 0.12, "sawtooth", null, { atraso: t, destino: musica, filtro: 600 })
    },
    sopro(p) { const s = espacial(p); ruido(1.7, 2500, 0.4 * Math.max(0.3, s.vol), { tipo: "bandpass", q: 0.5, ataque: 0.2, pan: s.pan }); tom(60, 1.6, 0.3 * Math.max(0.3, s.vol), "sawtooth", 50, { filtro: 300, pan: s.pan }) }
}

/** O zumbido do lugar, baixinho: dois tons desafinados e um ar filtrado. */
function ambiente(tema) {
    if (!ac) return
    pararAmbiente()
    const f = { lab: 55, fabrica: 49, estufa: 52, gelo: 46, nucleo: 41 }[tema] || 50
    const g = ac.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(0.07, ac.currentTime, 2)
    const filtro = ac.createBiquadFilter()
    filtro.type = "lowpass"
    filtro.frequency.value = 380
    g.connect(musica)
    filtro.connect(g)
    const nos = []
    for (const k of [1, 1.006, 1.5]) {
        const o = ac.createOscillator()
        o.type = "sawtooth"
        o.frequency.value = f * k
        o.connect(filtro)
        o.start()
        nos.push(o)
    }
    const lfo = ac.createOscillator(), lg = ac.createGain()
    lfo.frequency.value = 0.07
    lg.gain.value = 160
    lfo.connect(lg).connect(filtro.frequency)
    lfo.start()
    nos.push(lfo)
    const src = ac.createBufferSource()
    src.buffer = ruidoBuf
    src.loop = true
    const bf = ac.createBiquadFilter()
    bf.type = "bandpass"; bf.frequency.value = tema === "fabrica" ? 300 : tema === "gelo" ? 2400 : tema === "estufa" ? 600 : 900; bf.Q.value = 0.6
    const ng = ac.createGain()
    ng.gain.value = 0.25
    src.connect(bf).connect(ng).connect(g)
    src.start()
    nos.push(src)
    drone = { g: g, nos: nos }
}

function pararAmbiente() {
    if (!drone || !ac) return
    const d = drone
    drone = null
    d.g.gain.setTargetAtTime(0, ac.currentTime, 0.3)
    setTimeout(() => { for (const n of d.nos) try { n.stop() } catch (e) { /* já parou */ } }, 1500)
}

PZ.Audio = {
    iniciar: iniciar,
    volume: definirVolume,
    ouvinte: ouvinte,
    s: new Proxy(S, { get: (o, k) => (ac && o[k]) ? o[k] : () => {} }),
    ambiente: ambiente,
    pararAmbiente: pararAmbiente,
    pronto: () => !!ac,
    /** O contexto, o canal da música e o ruído (para a trilha, em trilha.js). */
    nos: () => ac ? { ac: ac, musica: musica, ruido: ruidoBuf } : null
}

})(window.PZ = window.PZ || {})
