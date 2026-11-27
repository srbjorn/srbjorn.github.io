/*
 * Protocolo Z — a trilha. Metal pesado, no espírito das trilhas de jogo de
 * matar demônio: duas guitarras distorcidas em dó dropado (uma de cada lado),
 * baixo e bateria com bumbo duplo. Composta para o jogo e sintetizada na hora
 * (Web Audio), sem arquivo nenhum, como o resto do som.
 *
 * Ela segue a luta, em quatro alturas:
 *   0  silêncio (menu, morte, a festa dos robozinhos)
 *   1  entre as ondas: o pulso abafado, como se viesse de trás da parede
 *   2  a onda: os riffs abertos, com a bateria inteira
 *   3  o chefão: mais rápida, com o breakdown e o solo
 * Subir corta na hora (a onda começa com o acorde, o prato e a queda grave);
 * descer espera o fim da frase.
 */
(function (PZ) {
"use strict"

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)
const RAIZ = 36          // dó grave (C2): a corda solta, em dó dropado
const SOLO = 60          // o dó do meio (C4): a base do solo
const ADIANTE = 0.2      // quanto do futuro fica agendado (s)

/*
 * As partes. Cada compasso tem 16 semicolcheias, um caractere por
 * semicolcheia; uma linha com um compasso só vale para todos.
 *
 * Guitarra (g): minúscula é a nota abafada com a palma (o "chug"), maiúscula
 * é o power chord aberto. A letra é a distância da raiz em semitons:
 * a = dó, b = ré♭, c = ré, d = mi♭, e = mi, f = fá, g = sol♭, h = sol,
 * i = lá♭, j = lá, k = si♭, l = si, m = dó de cima. "-" segura, "." cala e
 * "*" segura soltando o harmônico (o grito agudo).
 *
 * Bateria: k bumbo, s caixa, h pratos (x chimbal, o chimbal aberto,
 * r condução, c ataque). "x" é a batida cheia, "o" a fraca, 1–9 a força.
 * O bumbo "g" bate junto com cada ataque da guitarra.
 *
 * Solo (l): as letras contam do dó do meio (a = C4, m = C5, s = G♭5).
 */
const SECOES = {
    // entre as ondas
    espreita: { bpm: 132, vol: 0.55, filtro: 850, forca: 0.6,
        g: ["a.....a.....a...", "a.....a.....D---"], k: "g", h: "x...x...x...x..." },
    // a onda começa / a onda acabou
    entrada: { bpm: 132, crash: true, queda: true,
        g: ["A-----------aaaa"], k: "x...........xxxx", s: "............5689" },
    fecho: { bpm: 132, crash: true, g: ["A---------------"], k: "x..............." },
    // o riff da matilha
    riffA: { bpm: 132, crash: true,
        g: ["aa.aaD-.aa.aaB-.", "aa.aaD-.aaF-E-D-"],
        k: "g", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." },
    // o groove pesado, com a caixa no meio do compasso
    riffB: { bpm: 132, crash: true,
        g: ["A--aa.A--aa.a.a.", "A--aa.A--aa.G--*"],
        k: "g", s: "........x.......", h: "x...x...x...x..." },
    // o galope
    riffC: { bpm: 132,
        g: ["a.aaa.aaa.aaa.aa", "a.aaa.aaH---G---"],
        k: "g", s: "....x.......x...", h: "x.x.x.x.x.x.x.x." },
    // a descida cromática e a metralhadora
    riffD: { bpm: 132, crash: true,
        g: ["M--L--K--J--I---", "aaaaaaaaaaaaD-B-"],
        k: ["x..x..x..x..x...", "xxxxxxxxxxxxx.x."], s: ["................", "....x.......x..."],
        h: ["c.....c.....c...", "x.x.x.x.x.x.x.x."] },
    // o chefão chegou: o acorde, o trítono e a caixa crescendo
    entradaChefe: { bpm: 150, crash: true, queda: true,
        g: ["A---------------", "G-------H-------"],
        k: ["x...............", "x...x...x...x..."], s: ["................", "1122334455667789"] },
    // bumbo duplo e palhetada alternada
    chefeE: { bpm: 150, crash: true,
        g: ["aaaaaaaaBBBBaaaa", "aaaaaaaaGGGGHHHH"],
        k: "xxxxxxxxxxxxxxxx", s: "....x.......x...", h: "r.r.r.r.r.r.r.r." },
    // o breakdown, de três em três contra o quatro
    chefeF: { bpm: 150, crash: true,
        g: ["A--.....a.a.A---", "a..a..a..a..G-*-"],
        k: "g", s: "........x.......", h: "x...x...x...x..." },
    // o tema do chefão, com o solo
    chefeG: { bpm: 150,
        g: ["aa.aa.aa.aa.aa.a", "aa.aa.aa.aa.B---"],
        l: ["m---s---r-p-n---", "m---n-m-l---i---"],
        k: "g", s: "....x.......x...", h: "r.r.r.r.r.r.r.r." }
}
SECOES.chefeD = Object.assign({}, SECOES.riffD, { bpm: 150 })

// a ordem em cada altura ("!" é a virada da bateria no fim)
const CICLOS = {
    1: ["espreita"],
    2: ["riffA", "riffA!", "riffB", "riffB!", "riffA", "riffC!", "riffD", "riffB!"],
    3: ["chefeE", "chefeE!", "chefeF", "chefeF!", "chefeG", "chefeG!", "chefeD", "chefeE!"]
}
const ENTRADA = { 2: "entrada", 3: "entradaChefe" }

// o volume de cada parte na mistura
const NIVEL = { guitarra: 0.26, baixo: 0.17, bateria: 0.6, solo: 0.17 }

function biquad(ac, tipo, f, q, ganho) {
    const b = ac.createBiquadFilter()
    b.type = tipo
    b.frequency.value = f
    b.Q.value = q || 0.7
    if (ganho) b.gain.value = ganho
    return b
}

const curvas = {}
/** A curva do drive: tanh(k·x), normalizada. */
function curva(k) {
    if (curvas[k]) return curvas[k]
    const n = 4096, c = new Float32Array(n), tk = Math.tanh(k)
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / tk }
    return (curvas[k] = c)
}

function forcaDe(c) {
    if (c === "x") return 1
    if (c === "o") return 0.45
    if (c >= "1" && c <= "9") return (c.charCodeAt(0) - 48) / 9
    return 0
}

const ehNota = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z"

// ------------------------------------------------------------------ o motor

class Motor {
    constructor(ac, destino, ruido, offline) {
        this.ac = ac
        this.ruidoBuf = ruido
        this.offline = !!offline
        // a saída: o filtro (abafa entre as ondas e na pausa) e o volume
        this.saida = ac.createGain()
        this.saida.gain.value = 0
        this.filtro = biquad(ac, "lowpass", 16000, 0.8)
        this.filtro.connect(this.saida).connect(destino)
        this.bus = ac.createGain()
        this.bus.connect(this.filtro)
        this.bateria = ac.createGain()
        this.bateria.gain.value = NIVEL.bateria
        this.bateria.connect(this.bus)
        this.vozes = null
        this.tocando = false
        this.alvo = 0; this.modo = 0; this.ciclo = 0
        this.sec = null; this.barra = 0; this.pos = 0; this.dt = 0.1; this.prox = 0
        this.volOpcao = 0.7; this.abafado = false; this.geracao = 0
        this.so = null       // os testes tocam uma parte só
    }

    // -------------------------------------------------------------- as vozes que ficam ligadas

    ligarVozes() {
        if (this.vozes) return
        const ac = this.ac, v = { lados: [], saidas: [], osc: [] }
        // as duas guitarras, uma de cada lado, um pouco desafinadas e atrasadas entre si
        for (const [pan, cents, atraso] of [[-0.75, -7, 0], [0.75, 7, 0.009]]) {
            const l = { atraso: atraso, f: [65, 98, 131], osc: [], vg: [] }
            l.env = ac.createGain()
            l.env.gain.value = 0
            l.hp = biquad(ac, "highpass", 85, 0.7)      // aperta o grave antes do drive
            l.pre = biquad(ac, "lowpass", 3500, 0.7)     // a palma escurece aqui
            const drive = ac.createGain()
            drive.gain.value = 0.4
            const sh = ac.createWaveShaper()
            sh.curve = curva(9)
            sh.oversample = "4x"
            // a caixa de 4 alto-falantes
            const c1 = biquad(ac, "highpass", 70, 0.7)
            const c2 = biquad(ac, "peaking", 110, 0.8, 3)
            const c3 = biquad(ac, "peaking", 500, 1, -5)
            const c4 = biquad(ac, "peaking", 1900, 1, 3)
            l.cab = biquad(ac, "lowpass", 5200, 0.7)
            const c6 = biquad(ac, "lowpass", 7500, 0.5)
            const g = ac.createGain()
            g.gain.value = NIVEL.guitarra
            for (let i = 0; i < 3; i++) {
                const o = ac.createOscillator()
                o.type = "sawtooth"
                o.detune.value = cents + (i - 1) * 2
                const vg = ac.createGain()
                vg.gain.value = 0
                o.connect(vg).connect(l.env)
                o.start()
                l.osc.push(o); l.vg.push(vg); v.osc.push(o)
            }
            l.env.connect(l.hp).connect(l.pre).connect(drive).connect(sh).connect(c1).connect(c2).connect(c3).connect(c4).connect(l.cab).connect(c6).connect(g)
            if (ac.createStereoPanner) {
                const p = ac.createStereoPanner()
                p.pan.value = pan
                g.connect(p).connect(this.bus)
            } else g.connect(this.bus)
            v.saidas.push(g)
            v.lados.push(l)
        }
        // o baixo: serra e sub, um pouco sujo
        const b = { f: 33, osc: [] }
        b.env = ac.createGain()
        b.env.gain.value = 0
        const serra = ac.createOscillator(); serra.type = "sawtooth"
        const sub = ac.createOscillator(); sub.type = "sine"
        const subG = ac.createGain(); subG.gain.value = 0.8
        serra.connect(b.env); sub.connect(subG).connect(b.env)
        serra.start(); sub.start()
        b.osc.push(serra, sub); v.osc.push(serra, sub)
        const bsh = ac.createWaveShaper(); bsh.curve = curva(2)
        const bg = ac.createGain(); bg.gain.value = NIVEL.baixo
        b.env.connect(biquad(ac, "lowpass", 900, 0.7)).connect(bsh).connect(biquad(ac, "lowpass", 2600, 0.6)).connect(bg).connect(this.bus)
        v.saidas.push(bg)
        v.baixo = b
        // o solo: um drive leve e o eco
        v.solo = ac.createGain()
        const ssh = ac.createWaveShaper(); ssh.curve = curva(4)
        const sg = ac.createGain(); sg.gain.value = NIVEL.solo
        v.solo.connect(ssh).connect(biquad(ac, "lowpass", 3800, 0.7)).connect(sg).connect(this.bus)
        const eco = ac.createDelay(1); eco.delayTime.value = 0.3
        const volta = ac.createGain(); volta.gain.value = 0.3
        const molhado = ac.createGain(); molhado.gain.value = 0.35
        sg.connect(eco).connect(volta).connect(eco)
        eco.connect(molhado).connect(this.bus)
        v.saidas.push(sg, molhado)
        this.vozes = v
    }

    desligarVozes() {
        const v = this.vozes
        if (!v) return
        this.vozes = null
        for (const o of v.osc) try { o.stop() } catch (e) { /* já parou */ }
        for (const s of v.saidas) s.disconnect()
    }

    // -------------------------------------------------------------- tocar

    guitarra(t, c) {
        for (const l of this.vozes.lados) {
            const tt = t + l.atraso, g = l.env.gain
            if (c === ".") { g.setTargetAtTime(0, tt, 0.01); continue }
            if (c === "*") { this.harmonico(l, tt); continue }
            if (!ehNota(c)) continue
            const aberta = c < "a"
            const off = c.toLowerCase().charCodeAt(0) - 97
            const niv = aberta ? [1, 0.85, 0.6] : [1, 0.55, 0]
            for (let i = 0; i < 3; i++) {
                const f = hz(RAIZ + off + [0, 7, 12][i])
                l.osc[i].frequency.setValueAtTime(f, tt)
                l.vg[i].gain.setValueAtTime(niv[i], tt)
                l.f[i] = f
            }
            l.pre.frequency.setValueAtTime(aberta ? 3500 : 700, tt)
            l.cab.frequency.setValueAtTime(aberta ? 5200 : 2400, tt)
            g.setValueAtTime(0, tt)
            g.linearRampToValueAtTime(1, tt + 0.003)
            g.setTargetAtTime(aberta ? 0.5 : 0, tt + 0.003, aberta ? 0.3 : 0.05)
        }
    }

    baixo(t, c) {
        const b = this.vozes.baixo, g = b.env.gain
        if (c === ".") { g.setTargetAtTime(0, t, 0.015); return }
        if (!ehNota(c)) return
        const aberta = c < "a"
        b.f = hz(RAIZ - 12 + (c.toLowerCase().charCodeAt(0) - 97) % 12)
        for (const o of b.osc) o.frequency.setValueAtTime(b.f, t)
        g.setValueAtTime(0, t)
        g.linearRampToValueAtTime(1, t + 0.004)
        g.setTargetAtTime(aberta ? 0.6 : 0, t + 0.004, aberta ? 0.4 : 0.09)
    }

    /** O harmônico artificial: o grito agudo que a palheta arranca da corda. */
    harmonico(l, t) {
        const ac = this.ac, f = l.f[0] * 6
        const o = ac.createOscillator()
        o.type = "sawtooth"
        o.frequency.setValueAtTime(f, t)
        o.frequency.exponentialRampToValueAtTime(f * 1.06, t + 0.15)
        const lfo = ac.createOscillator(), lg = ac.createGain()
        lfo.frequency.value = 7
        lg.gain.value = f * 0.025
        lfo.connect(lg).connect(o.frequency)
        const g = ac.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.35, t + 0.01)
        g.gain.setTargetAtTime(0, t + 0.05, 0.3)
        o.connect(g).connect(l.hp)
        o.start(t); o.stop(t + 1.6)
        lfo.start(t); lfo.stop(t + 1.6)
    }

    solo(t, midi, dur) {
        const ac = this.ac, f = hz(midi), de = this.soloAntes || f
        for (const det of [-6, 6]) {
            const o = ac.createOscillator()
            o.type = "sawtooth"
            o.detune.value = det
            o.frequency.setValueAtTime(de, t)
            o.frequency.exponentialRampToValueAtTime(f, t + 0.035)
            // o vibrato entra devagar
            const lfo = ac.createOscillator(), lg = ac.createGain()
            lfo.frequency.value = 5.5
            lg.gain.setValueAtTime(0, t)
            lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(dur, 0.4))
            lfo.connect(lg).connect(o.frequency)
            const g = ac.createGain()
            g.gain.setValueAtTime(0, t)
            g.gain.linearRampToValueAtTime(0.5, t + 0.01)
            g.gain.setValueAtTime(0.5, t + dur - 0.03)
            g.gain.linearRampToValueAtTime(0, t + dur)
            o.connect(g).connect(this.vozes.solo)
            o.start(t); o.stop(t + dur + 0.02)
            lfo.start(t); lfo.stop(t + dur + 0.02)
        }
        this.soloAntes = f
    }

    // ---- a bateria (tudo nasce e morre a cada batida)

    ruido(t, dur, tipo, freq, q, v, tau) {
        const ac = this.ac, s = ac.createBufferSource()
        s.buffer = this.ruidoBuf
        const f = biquad(ac, tipo, freq, q)
        const g = ac.createGain()
        g.gain.setValueAtTime(v, t)
        g.gain.setTargetAtTime(0, t + 0.001, tau)
        s.connect(f).connect(g).connect(this.bateria)
        s.start(t, Math.random() * Math.max(0, this.ruidoBuf.duration - dur - 0.05))
        s.stop(t + dur)
    }

    tom(t, f0, f1, queda, v, tau, tipo) {
        const ac = this.ac, o = ac.createOscillator()
        o.type = tipo || "sine"
        o.frequency.setValueAtTime(f0, t)
        if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + queda)
        const g = ac.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(v, t + 0.002)
        g.gain.setTargetAtTime(0, t + 0.004, tau)
        o.connect(g).connect(this.bateria)
        o.start(t)
        o.stop(t + tau * 7 + 0.02)
    }

    bumbo(t, v) {
        this.tom(t, 160, 48, 0.06, 0.95 * v, 0.1)
        this.tom(t, 2600, 700, 0.012, 0.12 * v, 0.004, "triangle")
        this.ruido(t, 0.03, "highpass", 3000, 0.7, 0.18 * v, 0.004)
    }

    caixa(t, v) {
        this.tom(t, 230, 175, 0.04, 0.45 * v, 0.05, "triangle")
        this.ruido(t, 0.35, "bandpass", 2400, 0.6, 0.6 * v, 0.07)
        this.ruido(t, 0.2, "highpass", 6500, 0.7, 0.25 * v, 0.045)
    }

    prato(t, tipo, v) {
        if (tipo === "c") {
            this.ruido(t, 1.9, "highpass", 4200, 0.6, 0.3 * v, 0.5)
            this.ruido(t, 1.9, "bandpass", 8000, 0.8, 0.18 * v, 0.8)
        } else if (tipo === "r") {
            this.ruido(t, 0.5, "bandpass", 6000, 1.2, 0.13 * v, 0.18)
            this.tom(t, 3150, 0, 0, 0.025 * v, 0.25, "square")
        } else {
            const aberto = tipo === "o"
            this.ruido(t, aberto ? 0.5 : 0.08, "highpass", 8500, 0.7, 0.16 * v, aberto ? 0.12 : 0.022)
        }
    }

    surdo(t, f, v) {
        this.tom(t, f * 1.6, f, 0.08, 0.8 * v, 0.16)
        this.ruido(t, 0.12, "bandpass", f * 4, 1, 0.15 * v, 0.04)
    }

    /** A queda grave que abre a onda. */
    queda(t) {
        this.tom(t, 95, 26, 1.6, 0.9, 0.6)
        this.ruido(t, 1.2, "lowpass", 260, 0.7, 0.5, 0.35)
    }

    /** Uma semicolcheia de tudo. */
    passo(t) {
        const s = this.sec, b = this.barra, p = this.pos
        const linha = (x) => x === undefined ? "" : Array.isArray(x) ? x[b % x.length] : x
        const g = linha(s.g)[p]
        const toca = (parte) => !this.so || this.so === parte
        if (toca("guitarra")) this.guitarra(t, g)
        if (toca("baixo")) this.baixo(t, g === "*" ? "-" : g)
        if (toca("solo") && s.l) {
            const l = linha(s.l)
            if (l[p] >= "a" && l[p] <= "x") {
                let n = 1
                while (p + n < 16 && l[p + n] === "-") n++
                this.solo(t, SOLO + l.charCodeAt(p) - 97, n * this.dt)
            }
        }
        if (!toca("bateria")) return
        const f = s.forca || 1, humano = () => f * (0.94 + Math.random() * 0.12)
        if (s.crash && b === 0 && p === 0) this.prato(t, "c", 1)
        if (s.queda && b === 0 && p === 0) this.queda(t)
        // a virada: caixa e os tons descendo no último tempo
        if (this.virada && b === s.g.length - 1 && p >= 12) {
            if (p === 12) this.caixa(t, 0.9)
            else this.surdo(t, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 200, 150, 105][p], 0.9)
            if (p === 15) this.bumbo(t, 1)
            return
        }
        const ataque = ehNota(g)
        const vk = s.k === "g" ? (ataque ? 0.85 : 0) : forcaDe(linha(s.k)[p])
        if (vk) this.bumbo(t, vk * humano())
        const vs = forcaDe(linha(s.s)[p])
        if (vs) this.caixa(t, vs * humano())
        const h = linha(s.h)[p]
        if (h === "c" || h === "r" || h === "o") this.prato(t, h, humano())
        else if (h === "x") this.prato(t, "x", (p % 4 === 0 ? 1 : 0.7) * humano())
    }

    // -------------------------------------------------------------- a ordem

    /** A próxima parte; null para calar. */
    escolher(t) {
        if (this.alvo === 0) return false
        let nome = null
        if (this.alvo !== this.modo) {
            const de = this.modo
            this.modo = this.alvo
            this.ciclo = 0
            if (this.modo > de) nome = ENTRADA[this.modo] || null
            else if (this.modo === 1) nome = "fecho"
        }
        if (!nome) { const c = CICLOS[this.modo]; nome = c[this.ciclo++ % c.length] }
        this.virada = nome.endsWith("!")
        this.nome = nome.replace("!", "")
        this.sec = SECOES[this.nome]
        this.barra = 0
        this.pos = 0
        this.dt = 60 / this.sec.bpm / 4
        this.ajustar(t)
        return true
    }

    /** O volume e o filtro da parte (e da pausa). */
    ajustar(t) {
        const s = this.sec
        const v = this.volOpcao * this.volOpcao * (s && s.vol || 1) * (this.abafado ? 0.55 : 1)
        const f = Math.min(s && s.filtro || 16000, this.abafado ? 650 : 16000)
        this.saida.gain.setTargetAtTime(v, t, 0.08)
        this.filtro.frequency.setTargetAtTime(f, t, f > 5000 ? 0.06 : 0.25)
    }

    agendar(agora, ate) {
        if (!this.tocando) return
        if (this.prox < agora) this.prox = agora + 0.03
        while (this.prox < ate) {
            // subir corta na hora; descer espera a parte acabar
            if (!this.sec || this.alvo > this.modo) {
                if (!this.escolher(this.prox)) { this.calar(agora); return }
            }
            this.passo(this.prox)
            this.prox += this.dt
            if (++this.pos === 16) {
                this.pos = 0
                if (++this.barra >= this.sec.g.length) this.sec = null
            }
        }
    }

    definirAlvo(n, agora) {
        if (n === this.alvo) return
        this.alvo = n
        if (n > 0 && !this.tocando) {
            this.ligarVozes()
            this.tocando = true
            this.geracao++
            this.modo = 0
            this.sec = null
            this.prox = agora + 0.05
        } else if (n === 0 && this.tocando) this.calar(agora)
    }

    calar(agora, tau) {
        this.tocando = false
        this.alvo = 0; this.modo = 0; this.sec = null
        this.saida.gain.cancelScheduledValues(agora)
        this.saida.gain.setTargetAtTime(0, agora, tau || 0.25)
        this.desligarDepois(2000)
    }

    /** A morte: a fita para (o tom despenca) e some. */
    fita(agora) {
        if (!this.tocando || !this.vozes) return
        const fim = agora + 1.4, v = this.vozes
        const despenca = (o, f) => {
            o.frequency.cancelScheduledValues(agora)
            o.frequency.setValueAtTime(f, agora)
            o.frequency.exponentialRampToValueAtTime(Math.max(6, f * 0.1), fim)
        }
        for (const l of v.lados) {
            l.osc.forEach((o, i) => despenca(o, l.f[i]))
            l.env.gain.cancelScheduledValues(agora)
            l.env.gain.setTargetAtTime(0.6, agora, 0.02)
        }
        for (const o of v.baixo.osc) despenca(o, v.baixo.f)
        v.baixo.env.gain.cancelScheduledValues(agora)
        v.baixo.env.gain.setTargetAtTime(0.6, agora, 0.02)
        this.tocando = false
        this.alvo = 0; this.modo = 0; this.sec = null
        this.saida.gain.cancelScheduledValues(agora)
        this.saida.gain.setTargetAtTime(0, agora + 0.9, 0.2)
        this.desligarDepois(2600)
    }

    desligarDepois(ms) {
        const g = ++this.geracao
        if (!this.offline) setTimeout(() => { if (g === this.geracao && !this.tocando) this.desligarVozes() }, ms)
    }
}

// ------------------------------------------------------------------ a trilha do jogo

let motor = null, timer = null, oculto = false, volume = 0.7, abafado = false

function vivo() {
    if (motor) return motor
    const n = PZ.Audio.nos()
    if (!n) return null
    motor = new Motor(n.ac, n.musica, n.ruido)
    motor.volOpcao = volume
    motor.abafado = abafado
    return motor
}

function tique() {
    const m = motor
    if (!m || !m.tocando) { clearInterval(timer); timer = null; return }
    const agora = m.ac.currentTime
    // aba escondida: o relógio da página fica lento, então cala até voltar
    if (document.hidden) {
        if (!oculto) { oculto = true; m.saida.gain.setTargetAtTime(0, agora, 0.05) }
        return
    }
    if (oculto) { oculto = false; m.prox = agora + 0.05; m.ajustar(agora) }
    m.agendar(agora, agora + ADIANTE)
}

// (no Node, nos testes, o audio.js não está lá)
(PZ.Audio = PZ.Audio || {}).trilha = {
    /** A altura da trilha agora (0 a 3); chamada a cada quadro. */
    alvo(n) {
        const m = vivo()
        if (!m) return
        m.definirAlvo(volume > 0 ? n : 0, m.ac.currentTime)
        if (m.tocando && !timer) { timer = setInterval(tique, 40); tique() }
    },
    /** Pausa e telas por cima do jogo: abafada e mais baixa. */
    abafar(sim) {
        if (sim === abafado) return
        abafado = sim
        if (motor) { motor.abafado = sim; if (motor.tocando) motor.ajustar(motor.ac.currentTime) }
    },
    volume(v) {
        volume = v
        if (motor) { motor.volOpcao = v; if (motor.tocando) motor.ajustar(motor.ac.currentTime) }
    },
    fita() { if (motor) motor.fita(motor.ac.currentTime) },
    ligada: () => volume > 0,
    /** A parte que está tocando (para a bancada e os testes). */
    agora: () => motor && motor.tocando ? motor.nome : null,
    /**
     * Para os testes: grava a trilha sem tocar (OfflineAudioContext).
     * `roteiro`: [[segundo, altura ou "fita"], …]; `so`: guitarra, baixo, bateria ou solo.
     */
    gravar(seg, roteiro, so) {
        const sr = 44100, ac = new OfflineAudioContext(2, Math.ceil(sr * seg), sr)
        const ruido = ac.createBuffer(1, sr * 2, sr), d = ruido.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
        const bus = ac.createGain()
        bus.gain.value = 0.5             // como o canal da música no jogo
        bus.connect(ac.destination)
        const m = new Motor(ac, bus, ruido, true)
        m.volOpcao = volume
        m.so = so || null
        const partes = []
        for (let t = 0; t < seg; t += 0.05) {
            for (const [q, n] of roteiro) {
                if (q < t || q >= t + 0.05) continue
                if (n === "fita") m.fita(q)
                else m.definirAlvo(n, q)
            }
            const antes = m.nome
            m.agendar(t, t + ADIANTE)
            if (m.nome !== antes && m.tocando) partes.push([+t.toFixed(2), m.nome])
        }
        return ac.startRendering().then((buf) => ({ buf: buf, partes: partes }))
    },
    SECOES: SECOES,
    CICLOS: CICLOS
}

})(typeof window !== "undefined" ? (window.PZ = window.PZ || {}) : (globalThis.PZ = globalThis.PZ || {}))
