/*
 * Protocolo Z — a cola: entrada, laço, a mão na tela, o HUD da viseira e os
 * menus. O jogo em si mora em nucleo.js; o desenho, em render.js.
 *
 * A entrada tem os dois caminhos do Kuramacraft (referencia/jogo/jogo.js):
 *
 *   no app        o host lê teclado e mouse (`Janela.modo_jogo`, winhost.py) e
 *                 manda `tec:` (as teclas apertadas, em códigos de tecla
 *                 virtual), `mov:dx,dy` (o mouse preso andou) e `solto`
 *   no navegador  teclado, mouse e `requestPointerLock` normais — abrindo
 *                 jogo.html direto, que é como ele é testado sem o app
 *
 * A ponte da janela é a mesma `JogoApi` do app: `capturar`, `fechar` e
 * `set_drag_bar`. Nada além disso.
 */
(function (PZ) {
"use strict"

const host = !!(window.chrome && window.chrome.webview)
const api = () => (window.pywebview && window.pywebview.api) || null
const $ = (id) => document.getElementById(id)
const M4 = PZ.M4, Mod = PZ.Modelos, A = PZ.Audio

// A fonte de pixel não tem as maiúsculas com acento: tira só delas.
const SEM = { "Á": "A", "À": "A", "Â": "A", "Ã": "A", "É": "E", "Ê": "E", "Í": "I", "Ó": "O", "Ô": "O", "Õ": "O", "Ú": "U", "Ç": "C" }
const limpar = (t) => String(t).replace(/[ÁÀÂÃÉÊÍÓÔÕÚÇ]/g, (c) => SEM[c])
function limparPixel(raiz) {
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement
        if (el && /Kurama Pixel/.test(getComputedStyle(el).fontFamily)) n.nodeValue = limpar(n.nodeValue)
    }
}

const K = { W: 87, A: 65, S: 83, D: 68, E: 69, F: 70, R: 82, Q: 81, V: 86, G: 71, L: 76, C: 67, Z: 90,
            ESPACO: 32, SHIFT: 16, CTRL: 17, ESC: 27, F3: 114, UM: 49, DOIS: 50, TRES: 51, ESQ: 1, DIR: 2, MEIO: 4 }

// ------------------------------------------------------------------ opções e recordes

const CHAVE = "protocolo-z"
const salvo = (() => {
    try { return JSON.parse(window.localStorage.getItem(CHAVE)) || {} } catch (e) { return {} }
})()
const opt = Object.assign({ sens: 1, vol: 0.8, musica: 0.7, fov: 78, res: 1, inv: false }, salvo.opcoes || {})
const prog = { nivelMax: salvo.nivelMax || 0, recorde: salvo.recorde || { ondas: 0, pontos: 0, abates: 0 },
               conquistas: salvo.conquistas || {} }

function gravar() {
    try { window.localStorage.setItem(CHAVE, JSON.stringify({ opcoes: opt, nivelMax: prog.nivelMax, recorde: prog.recorde, conquistas: prog.conquistas })) }
    catch (e) { /* sem armazenamento: vale só nesta janela */ }
}

// ------------------------------------------------------------------ o código antigo
//
// ↑ ↑ ↓ ↓ ← → ← → B A, no menu ou no meio do jogo: liga (e desliga) o Modo
// Cabeçudo — as cabeças quase dobram de tamanho, a voz deles afina e a
// viseira fica arco-íris.

const KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]
let konamiI = 0
function teclaSegredo(k) {
    if (k === KONAMI[konamiI]) {
        konamiI++
        if (konamiI === KONAMI.length) { konamiI = 0; alternarCabecudo() }
    } else konamiI = k === KONAMI[0] ? 1 : 0
}

function alternarCabecudo() {
    PZ.segredos.cabecudo = !PZ.segredos.cabecudo
    A.iniciar()
    A.s.konami()
    conquistar("konami")
    // no jogo, o aviso grande; no menu, a linha embaixo do logo
    if (estado.tela === null) mensagem("MODO CABEÇUDO", PZ.segredos.cabecudo ? "as cabeças cresceram (o código de novo desliga)" : "desligado", "#ff7be6")
    $("segredoMenu").textContent = PZ.segredos.cabecudo ? limpar("MODO CABEÇUDO LIGADO") : ""
    rostoAntes = ""
}

// ------------------------------------------------------------------ entrada

const tela = $("tela")
const teclas = new Set()
const pulsos = new Set()
let movX = 0, movY = 0, roda = 0
let capturado = false
let travaMouse = false

function definirTeclas(lista) {
    for (const k of lista) if (!teclas.has(k)) { pulsos.add(k); teclaSegredo(k) }
    teclas.clear()
    for (const k of lista) teclas.add(k)
}

if (host) {
    window.chrome.webview.addEventListener("message", (ev) => {
        const msg = typeof ev.data === "string" ? ev.data : ""
        if (msg.startsWith("tec:")) definirTeclas(msg.length > 4 ? msg.slice(4).split(",").map(Number) : [])
        else if (msg.startsWith("mov:")) {
            const n = msg.slice(4).split(",").map(Number)
            const dpr = window.devicePixelRatio || 1
            movX += (n[0] || 0) / dpr
            movY += (n[1] || 0) / dpr
        } else if (msg === "solto") perdeuOMouse()
    })
    // no menu (o mouse solto), o teclado chega como evento normal da página
    window.addEventListener("keydown", (ev) => { if (!capturado && !ev.repeat) teclaSegredo(ev.keyCode) })
} else {
    window.addEventListener("keydown", (ev) => {
        if ([114, 32, 9, 17, 81, 71, 70, 90, 37, 38, 39, 40].includes(ev.keyCode) || (ev.ctrlKey && capturado)) ev.preventDefault()
        if (!ev.repeat) teclaSegredo(ev.keyCode)
        // a trava do mouse só volta dentro do próprio evento da tecla
        if (ev.keyCode === 27 && estado.tela === "pausa" && performance.now() - estado.telaDesde > 350) { fecharTelas(); capturar(); return }
        if (!teclas.has(ev.keyCode)) pulsos.add(ev.keyCode)
        teclas.add(ev.keyCode)
    })
    window.addEventListener("keyup", (ev) => teclas.delete(ev.keyCode))
    const botao = (b) => (b === 0 ? 1 : b === 2 ? 2 : 4)
    tela.addEventListener("mousedown", (ev) => {
        if (!document.pointerLockElement) return
        const k = botao(ev.button)
        if (!teclas.has(k)) pulsos.add(k)
        teclas.add(k)
    })
    window.addEventListener("mouseup", (ev) => teclas.delete(botao(ev.button)))
    window.addEventListener("mousemove", (ev) => {
        if (document.pointerLockElement) { movX += ev.movementX; movY += ev.movementY }
    })
    document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement) perdeuOMouse() })
    document.addEventListener("pointerlockerror", () => { capturado = false; if (estado.tela === null) abrirTela("pausa") })
    window.addEventListener("blur", () => teclas.clear())
}
window.addEventListener("contextmenu", (ev) => ev.preventDefault())
window.addEventListener("wheel", (ev) => { if (capturado) roda += Math.sign(ev.deltaY) }, { passive: true })
tela.addEventListener("mousedown", () => { if (!capturado && estado.tela === null && estado.jogando) capturar() })

function capturar() {
    A.iniciar()
    if (host) { const a = api(); if (a) a.capturar(true) }
    else if (tela.requestPointerLock && !estado.teste) {
        try {
            const p = tela.requestPointerLock()
            if (p && p.catch) p.catch(() => { capturado = false; if (estado.tela === null && estado.jogando) abrirTela("pausa") })
        } catch (e) { /* sem trava: o mouse fica solto */ }
    }
    capturado = true
    travaMouse = true
    teclas.clear()
    pulsos.clear()
    movX = movY = 0
}

function soltar() {
    if (host) { const a = api(); if (a) a.capturar(false) }
    else if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock()
    capturado = false
}

/** O mouse saiu (Esc, outra janela na frente): pausa, se estava jogando. */
function perdeuOMouse() {
    capturado = false
    teclas.clear()
    if (estado.tela === null && estado.jogando && jogo && jogo.fase === "jogando") abrirTela("pausa")
}

// ------------------------------------------------------------------ estado

let R = null, jogo = null
const estado = {
    tela: "carregando", telaVolta: null, telaDesde: 0, jogando: false, teste: false,
    tremor: 0, sangue: 0, flash: 0, morteT: 0, lanterna: true, fps: false,
    ultimoDano: -9, feliz: 0, vidaAntes: 100, coracao: 0
}

function abrirTela(nome, volta) {
    estado.tela = nome
    estado.telaDesde = performance.now()
    if (volta !== undefined) estado.telaVolta = volta
    for (const id of ["menu", "pausa", "opcoes", "ajuda", "conquistas", "nivelFim", "vitoria", "fim", "carregando"]) $(id).hidden = id !== nome
    if (nome !== null) soltar()
    $("hud").hidden = !estado.jogando
    if (nome === "menu") montarMenu()
    if (nome === "pausa" && jogo) {
        $("pausaInfo").textContent = "Nível " + (jogo.nivelIdx + 1) + " — " + jogo.nivel.nome + " · onda " + Math.max(1, jogo.onda.n)
    }
    if (nome === "opcoes") mostrarOpcoes()
    if (nome === "conquistas") mostrarConquistas()
    if (nome && $(nome)) limparPixel($(nome))
}

function fecharTelas() {
    estado.tela = null
    for (const id of ["menu", "pausa", "opcoes", "ajuda", "conquistas", "nivelFim", "vitoria", "fim", "carregando"]) $(id).hidden = true
    $("hud").hidden = false
}

// ------------------------------------------------------------------ começar e trocar de nível

function iniciarJogo(nivel) {
    A.iniciar()
    jogo = new PZ.Jogo({ deus: estado.deus })
    jogo.novoJogo(nivel)
    estado.jogando = true
    estado.morteT = 0
    estado.parado = 0
    estado.expr = null
    vm.reiniciar()
    tratarEventos()
    fecharTelas()
    capturar()
}

function construirNivel() {
    R.construirNivel(jogo.mapa, jogo.nivel)
    A.ambiente(jogo.nivel.tema)
    // começa olhando para o lado mais aberto
    const m = jogo.mapa, ix = m.inicio.x, iz = m.inicio.z
    let melhor = 0, ang = 0
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, dx = Math.sin(a), dz = -Math.cos(a)
        let n = 0
        while (n < 30 && m.alt(Math.floor((ix + 0.5 + dx * n * 0.5)), Math.floor((iz + 0.5 + dz * n * 0.5))) === 0) n++
        if (n > melhor) { melhor = n; ang = a }
    }
    jogo.jog.yaw = ang
}

// ------------------------------------------------------------------ a mão na tela

const vm = {
    reiniciar() {
        this.kick = 0; this.clarao = 0; this.claraoRot = 0; this.swayX = 0; this.swayY = 0
        this.corre = 0; this.pouso = 0; this.granada = 0; this.mira = 0; this.boca = null; this.bocaCam = null
    },
    passo(dt, dYaw, dPitch) {
        this.kick = Math.max(0, this.kick - dt * 9)
        this.clarao = Math.max(0, this.clarao - dt)
        this.granada = Math.max(0, this.granada - dt)
        this.pouso = Math.max(0, this.pouso - dt * 4)
        const alvoX = Math.max(-0.05, Math.min(0.05, -dYaw * 0.6)), alvoY = Math.max(-0.05, Math.min(0.05, dPitch * 0.6))
        this.swayX += (alvoX - this.swayX) * Math.min(1, dt * 10)
        this.swayY += (alvoY - this.swayY) * Math.min(1, dt * 10)
        const j = jogo.jog
        this.corre += ((j.correndo ? 1 : 0) - this.corre) * Math.min(1, dt * 9)
        this.mira += (j.mira - this.mira) * Math.min(1, dt * 20)
    },
    /** A arma e os braços, em espaço de câmera. */
    montar(t) {
        const j = jogo.jog, s = jogo.armaAtual()
        if (!s || j.morto || j.reiniciando > 0) return []
        const ar = Mod.arma(s.id, s.nivel)
        const m = this.mira
        let px = 0.19 * (1 - m), py = -0.2 * (1 - m) - ar.mira * m, pz = -0.42 + 0.08 * m
        let rx = 0, ry = -0.05 * (1 - m), rz = 0
        // balanço do passo
        const fase = j.passo / 4.2 * Math.PI * 2
        const anda = Math.min(1, j.vel / 4) * (1 - 0.85 * m) * (1 + this.corre * 0.8)
        px += Math.sin(fase) * 0.014 * anda
        py -= Math.abs(Math.cos(fase)) * 0.016 * anda
        // respira parado
        py += Math.sin(t * 1.6) * 0.003 * (1 - m)
        // atraso do mouse
        px += this.swayX * (1 - 0.7 * m); py += this.swayY * (1 - 0.7 * m)
        ry += this.swayX * 1.5 * (1 - 0.7 * m)
        // coice
        const pesada = s.id === "estilhaco" || s.id === "supernova" || s.id === "gama" || s.id === "ferrao" || s.id === "uivo"
        pz += this.kick * (pesada ? 0.09 : 0.045)
        rx += this.kick * (s.id === "faisca" ? 0.22 : s.id === "uivo" ? 0.35 : s.id === "ferrao" ? 0.18 : 0.1)
        // correndo: a arma vai para o lado
        const c = this.corre
        px += -0.06 * c; py += -0.05 * c; ry += 0.75 * c; rz += 0.35 * c; rx -= 0.15 * c
        // recarga: desce, gira e volta
        if (j.recarga > 0) {
            const k = 1 - j.recarga / j.recargaTotal
            const d = Math.sin(k * Math.PI)
            py -= 0.11 * d; rz += 0.55 * d; rx -= 0.25 * d; px -= 0.03 * d
        }
        // troca
        if (j.troca > 0) {
            const k = j.troca > 0.25 ? (0.5 - j.troca) / 0.25 : j.troca / 0.25
            py -= 0.4 * k; rx -= 0.6 * k
        }
        // forja: a arma desce e brilha
        let emis = 0
        if (j.forjando > 0) {
            const k = Math.min(1, (2.4 - j.forjando) / 0.3, j.forjando / 0.3)
            py -= 0.32 * k; rx -= 0.5 * k
            emis = 0.5 + Math.sin(t * 20) * 0.3
        }
        // granada e garra: a arma sai do caminho
        if (this.granada > 0) { const k = Math.sin((1 - this.granada / 0.6) * Math.PI); py -= 0.12 * k; rx -= 0.3 * k }
        if (j.corpo > 0) { const k = Math.sin((1 - j.corpo / 0.55) * Math.PI); px += 0.08 * k; py -= 0.1 * k; rz -= 0.4 * k }
        py -= this.pouso * 0.04
        const mArma = PZ.cadeia(M4.trans(px, py, pz), M4.ry(ry), M4.rx(rx), M4.rz(rz))
        const itens = [{ geo: ar.geo, m: mArma, emis: emis }]
        itens.push({ geo: Mod.braco(false), m: PZ.cadeia(mArma, M4.ry(0.35), M4.rx(0.5)) })
        // a mão esquerda: no guarda-mão, ou dando a garrada, ou jogando a granada
        // (garrada e granada ficam mais longe da câmera e com o braço apontado para baixo:
        //  assim a manga sai pela borda de baixo da tela em vez de atravessar a câmera e aparecer cortada)
        if (j.corpo > 0) {
            const k = 1 - j.corpo / 0.55
            const a = -1.2 + k * 2.4
            const mE = PZ.cadeia(M4.trans(-0.14 + k * 0.28, -0.16 + Math.sin(k * Math.PI) * 0.07, -0.5), M4.ry(-0.6 - a * 0.4), M4.rx(0.8), M4.rz(a))
            itens.push({ geo: Mod.braco(true), m: mE })
        } else if (this.granada > 0) {
            const k = 1 - this.granada / 0.6
            const mE = PZ.cadeia(M4.trans(-0.2, -0.17 + Math.sin(k * Math.PI) * 0.12, -0.44 - k * 0.12), M4.ry(-0.4), M4.rx(0.9 - k * 0.9))
            itens.push({ geo: Mod.braco(true), m: mE })
        } else if (ar.duasMaos) {
            const zg = ar.boca[2] * 0.55
            itens.push({ geo: Mod.braco(true), m: PZ.cadeia(mArma, M4.trans(-0.01, -0.005, zg), M4.ry(-0.55), M4.rx(0.42)) })
        }
        // onde fica a boca do cano (na câmera e no mundo)
        this.bocaCam = M4.ponto(mArma, ar.boca[0], ar.boca[1], ar.boca[2])
        return itens
    }
}
vm.reiniciar()

// ------------------------------------------------------------------ câmera

function camera(t) {
    const j = jogo.jog
    const o = jogo.olho()
    let pitch = j.pitch, yaw = j.yaw, roll = 0
    if (jogo.fase === "morrendo" || jogo.fase === "fim") {
        const k = Math.min(1, estado.morteT / 1.2)
        o[1] = j.y + j.olho * (1 - k) + 0.25 * k
        pitch = pitch * (1 - k) + 0.3 * k
        roll = k * 0.8
    }
    if (estado.tremor > 0) {
        const s = estado.tremor * 0.06
        yaw += (Math.random() - 0.5) * s
        pitch += (Math.random() - 0.5) * s
    }
    const base = opt.fov * Math.PI / 180
    const s = jogo.statsAtual()
    const zoom = s ? s.zoom : 0.75
    let fov = base * (1 - (1 - zoom) * vm.mira) * (1 + 0.06 * vm.corre)
    if (roll) { /* sem rolagem na matriz: a queda já basta */ }
    return { olho: o, yaw: yaw, pitch: Math.max(-1.5, Math.min(1.5, pitch)), fov: fov }
}

function eixos(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw)
    const f = [sy * cp, sp, -cy * cp], d = [cy, 0, sy]
    const c = [d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], d[0] * f[1] - d[1] * f[0]]
    const l = Math.hypot(c[0], c[1], c[2])
    return { f: f, d: d, c: [c[0] / l, c[1] / l, c[2] / l] }
}

const FOV_VM = 62 * Math.PI / 180

/** A boca do cano no mundo, corrigida para a projeção do mundo (a mão usa outra). */
function bocaNoMundo(cam) {
    if (!vm.bocaCam) return jogo.olho()
    const k = Math.tan(cam.fov / 2) / Math.tan(FOV_VM / 2)
    const e = eixos(cam)
    const b = vm.bocaCam
    const cm = M4.mundoDaCamera(cam.olho, e.d, e.c, e.f)
    return M4.ponto(cm, b[0] * k, b[1] * k, b[2])
}

// ------------------------------------------------------------------ eventos do núcleo

const DESC_PODER = { municao: "reserva cheia", recarga: "todas as armas carregadas", critico: "tudo morre com um tiro",
                     dobro: "cada abate vale o dobro", escudo: "nada te atinge", congelar: "os corrompidos pararam",
                     furia: "tiro rápido sem gastar o pente", bonus: "pontos na conta",
                     vampiro: "cada acerto devolve vida", drone: "o robozinho atira com você", patas: "mais rápida e sem cansar",
                     liquidacao: "Caixa Glitch por 10 pontos", vida: "um backup a mais", booper: "a arma maravilha: boop!" }
const COR_MSG_PODER = { municao: "#4dff8a", recarga: "#62f3ff", critico: "#ff4f6d", dobro: "#ffc93c", escudo: "#6b9bff",
                        congelar: "#9fe8ff", furia: "#ff4fd8", bonus: "#ffd84a", vampiro: "#ff3b5c", drone: "#c88bff",
                        patas: "#5dffc8", liquidacao: "#ff8bea", vida: "#5dff7a", booper: "#ff7bd0" }
const COR_NIVEL = [[0.4, 1.0, 1.1], [1.1, 0.35, 0.95], [1.2, 0.85, 0.25], [1.3, 0.4, 0.18]]
const COR_MONSTRO = { corrompido: [1, 0.17, 0.37], corredor: [0.8, 1, 0.2], cuspidor: [0.3, 1, 0.55], bomba: [1, 0.6, 0.15],
                      brutamonte: [1, 0.36, 0.12], omega: [0.8, 0.3, 1], saltador: [1, 0.2, 0.33], uivador: [0.55, 0.42, 1],
                      lobo: [0.4, 0.95, 1.1], gosma: [0.5, 1, 0.25], urso: [0.6, 0.9, 1.1] }
const COR_ELEM = { fogo: [1.3, 0.55, 0.15], gelo: [0.55, 0.9, 1.3], choque: [0.55, 0.8, 1.3] }
const NOME_ELEM = { fogo: "FOGO", gelo: "GELO", choque: "CHOQUE" }
const corRGB = (h) => { const c = PZ.cor(h); return c }
let camAtual = null

// As conquistas (ficam salvas). As de `segredo: true` aparecem como ??? até sair.
const CONQUISTAS = [
    { id: "abate", nome: "Primeiro abate", desc: "derrubar um corrompido" },
    { id: "cabecas", nome: "Mira de Protogen", desc: "100 tiros na cabeça numa partida" },
    { id: "lobo", nome: "Caçadora de alfas", desc: "derrotar o Lobo Alfa" },
    { id: "gosma", nome: "Desentupidora", desc: "derrotar a Matriarca Gosma" },
    { id: "urso", nome: "Degelo", desc: "derrotar o Urso Glacial" },
    { id: "omega", nome: "Fim do Protocolo", desc: "derrotar o Sentinela Ômega" },
    { id: "mk4", nome: "Lendária", desc: "forjar uma arma até o Mk IV" },
    { id: "uivo", nome: "Uivo da matilha", desc: "atordoar 5 de uma vez com o Uivo" },
    { id: "atomica", nome: "Cogumelo", desc: "vaporizar 15 com uma bomba atômica" },
    { id: "onda30", nome: "Sobrevivente", desc: "chegar à onda 30" },
    { id: "boop", nome: "Boop!", desc: "dar um boop de garra num protogen corrompido", segredo: true },
    { id: "boop10", nome: "Booper profissional", desc: "10 boops numa partida", segredo: true },
    { id: "robozinhos", nome: "Que comece a festa", desc: "achar os 3 robozinhos escondidos de um nível", segredo: true },
    { id: "booper", nome: "Arma maravilha", desc: "atirar com o Booper 3000", segredo: true },
    { id: "pelucia", nome: "Um oi do autor", desc: "achar o Bjorn de pelúcia", segredo: true },
    { id: "konami", nome: "↑↑↓↓←→←→BA", desc: "o código antigo", segredo: true }
]

function conquistar(id) {
    if (prog.conquistas[id]) return
    const c = CONQUISTAS.find((q) => q.id === id)
    if (!c) return
    prog.conquistas[id] = Date.now()
    gravar()
    mensagem("CONQUISTA", c.nome, "#ffc93c")
    A.s.conquista()
    expressao("estrelas", 2)
}

function mostrarConquistas() {
    const n = CONQUISTAS.filter((c) => prog.conquistas[c.id]).length
    $("conquistasConta").textContent = n + " de " + CONQUISTAS.length
    $("conquistasLista").innerHTML = CONQUISTAS.map((c) => {
        const tem = !!prog.conquistas[c.id]
        const nome = tem || !c.segredo ? c.nome : "???"
        const desc = tem || !c.segredo ? c.desc : "um segredo"
        return '<div class="conq' + (tem ? " tem" : "") + '"><b>' + nome + "</b><span>" + desc + "</span></div>"
    }).join("")
}

/** O "BOOP!" que pula no meio da tela. */
function boopNaTela() {
    const el = document.createElement("span")
    el.textContent = "BOOP!"
    el.style.left = (Math.random() * 60 - 30) + "px"
    $("boops").appendChild(el)
    setTimeout(() => el.remove(), 900)
}

function tratarEventos() {
    const evs = jogo.eventos
    jogo.eventos = []
    const fx = R.fx, j = jogo.jog
    for (const e of evs) {
        switch (e.t) {
            case "nivel":
                construirNivel()
                mensagem("NÍVEL " + (e.i + 1), e.nivel.nome.toUpperCase() + " — " + e.nivel.sub, "#62f3ff")
                break
            case "tiro": {
                if (e.arma === "booper") conquistar("booper")
                vm.kick = 1
                vm.clarao = 0.05
                vm.claraoRot = Math.random() * 6
                const cor = COR_NIVEL[e.nivel - 1]
                const b = camAtual ? bocaNoMundo(camAtual) : jogo.olho()
                fx.luz(b, cor.map((v) => v * 2.2), 7, 0.07)
                A.s.tiro(e.arma, e.nivel)
                break
            }
            case "traco": {
                const cor = COR_NIVEL[e.nivel - 1]
                const b = camAtual ? bocaNoMundo(camAtual) : jogo.olho()
                if (e.arma === "gama") {
                    fx.feixe(b, e.ate, 0.09, [cor[0] * 0.9, cor[1] * 0.9, cor[2] * 0.9, 1], 0.35)
                    fx.feixe(b, e.ate, 0.025, [1, 1, 1, 1], 0.25)
                } else if (e.arma === "nevasca") {
                    fx.feixe(b, e.ate, 0.05, [0.35, 0.65, 0.9, 1], 0.09)
                    fx.feixe(b, e.ate, 0.015, [0.9, 1, 1, 1], 0.07)
                    if (Math.random() < 0.5) fx.brilho(e.ate, 0.25, [0.5, 0.85, 1.1], 0.15, 1)
                } else if (e.arma === "ferrao") {
                    fx.feixe(b, e.ate, 0.035, [cor[0] * 0.8, cor[1] * 0.8, cor[2] * 0.8, 1], 0.3)
                    fx.feixe(b, e.ate, 0.01, [1, 1, 1, 1], 0.2)
                } else fx.feixe(b, e.ate, e.arma === "estilhaco" ? 0.012 : 0.02, [cor[0] * 0.8, cor[1] * 0.8, cor[2] * 0.8, 1], 0.06)
                break
            }
            case "chamas": {
                // o jorro da Fornalha: chamas saindo da boca, para onde ela olha
                const b = camAtual ? bocaNoMundo(camAtual) : jogo.olho()
                const f = jogo.frente()
                for (let i = 0; i < 3; i++) {
                    const v = 9 + Math.random() * 4
                    fx.chama(b, [f[0] * v + (Math.random() - 0.5) * 1.6, f[1] * v + (Math.random() - 0.5) * 1.2 + 0.6, f[2] * v + (Math.random() - 0.5) * 1.6],
                             0.12 + Math.random() * 0.1)
                }
                if (Math.random() < 0.3) fx.luz([b[0] + f[0] * 2, b[1] + f[1] * 2, b[2] + f[2] * 2], [2.2, 1.0, 0.3], 7, 0.1)
                break
            }
            case "droneTiro":
                fx.feixe(e.de, e.ate, 0.025, [0.8, 0.4, 1.2, 1], 0.08)
                fx.brilho(e.de, 0.18, [0.8, 0.4, 1.2], 0.08)
                fx.faiscas(e.ate, 3, [0.9, 0.5, 1.2], 3)
                A.s.droneTiro(e.de)
                break
            case "choque":
                fx.raio(e.pontos, [0.5, 0.8, 1.2], 0.2)
                for (const q of e.pontos) fx.brilho(q, 0.5, [0.5, 0.8, 1.2], 0.2)
                A.s.choque(e.pontos[0])
                break
            case "elemento": {
                const c = COR_ELEM[e.elem]
                fx.brilho(e.p, 0.9, c, 0.3, 2)
                fx.faiscas(e.p, 8, c, 4)
                if (e.elem === "fogo") A.s.fogo(e.p)
                break
            }
            case "congelou":
                fx.brilho(e.p, 1.1, [0.55, 0.9, 1.3], 0.35, 2)
                fx.cubinhos(e.p, 6, [0.7, 0.9, 1.0], 2)
                A.s.congelou(e.p)
                break
            case "boop":
                A.s.boop(e.p, e.garra)
                fx.brilho(e.p, 0.5, [1.2, 0.35, 0.85], 0.5, 22)
                boopNaTela()
                if (e.garra) { conquistar("boop"); if (e.n >= 10) conquistar("boop10") }
                expressao("coracao", 1.6)
                break
            case "coracaoFim": fx.brilho(e.p, 0.6, [1.2, 0.35, 0.85], 0.35, 22); fx.faiscas(e.p, 6, [1, 0.5, 0.9], 3); A.s.coracao(e.p); break
            case "robozinho":
                if (e.pelucia) { A.s.pelucia(); conquistar("pelucia") }
                A.s.achou(e.n)
                expressao("coracao", 1.6)
                fx.brilho(e.p, 1.2, [0.8, 0.4, 1.3], 0.5, 2)
                fx.cubinhos(e.p, 10, [0.85, 0.6, 1.2], 3)
                mensagem(e.pelucia ? "BJORN DE PELÚCIA" : "ROBOZINHO " + e.n + " DE " + e.total,
                         e.pelucia ? "um oi do autor, o SrBjorn (" + e.n + " de " + e.total + ")" : e.n < e.total ? "ainda tem mais escondido…" : "", "#c88bff")
                break
            case "segredo":
                // a festa: a música secreta, todo mundo dança, e o Booper no chão
                A.s.musicaSecreta()
                conquistar("robozinhos")
                mensagem("A MATILHA DANÇA", "a música secreta — e o Booper caiu na sua frente", "#ff7bd0")
                estado.feliz = 14
                break
            case "uivoJog":
                if (e.n >= 5) conquistar("uivo")
                // o Uivo: a onda azul-violeta que sai da Protogen
                fx.brilho(e.p, 12, [0.6, 0.3, 1.3], 0.6, 2)
                fx.brilho(e.p, 6, [0.8, 0.5, 1.4], 0.4, 11)
                fx.luz(e.p, [2.5, 1.2, 4], 18, 0.6)
                estado.tremor = Math.max(estado.tremor, 0.6)
                estado.uivoT = 1.2
                A.s.uivo()
                mensagem("UIVO DA PROTOGEN", e.n ? e.n + (e.n === 1 ? " corrompido atordoado" : " corrompidos atordoados") : "fúria liberada", "#c88bff")
                break
            case "uivoMonstro": A.s.uivoMonstro([e.e.x, 1.6, e.e.z]); fx.brilho([e.e.x, e.e.y + 1.7, e.e.z], 2.5, [0.5, 0.4, 1.1], 0.5, 2); break
            case "salto": A.s.salto([e.e.x, 1, e.e.z], e.e.def.chefe); break
            case "aterrissou": fx.fumaca([e.e.x, 0.1, e.e.z], 3, [0.3, 0.3, 0.32]); A.s.aterrissou([e.e.x, 0.3, e.e.z]); break
            case "poca": A.s.poca(e.p); fx.faiscas([e.p[0], 0.1, e.p[2]], 6, [0.5, 1, 0.25], 3); break
            case "estilhaco":
                fx.brilho(e.p, 2.5, [0.55, 0.9, 1.3], 0.35, 2)
                fx.cubinhos(e.p, 18, [0.75, 0.92, 1.05], 6)
                fx.fumaca(e.p, 6, [0.5, 0.6, 0.7])
                estado.tremor = Math.max(estado.tremor, Math.max(0, 0.9 - Math.hypot(e.p[0] - j.x, e.p[2] - j.z) / 12))
                A.s.estilhaco(e.p)
                break
            case "arremesso": A.s.arremesso([e.e.x, 3, e.e.z]); break
            case "sopro": A.s.sopro([e.e.x, 3, e.e.z]); break
            case "ninhada": mensagem("A NINHADA ESTÁ VINDO", e.n + " inchados", "#7dff3a"); A.s.rugido([e.e.x, 2, e.e.z]); break
            case "impacto":
                if (e.monstro) {
                    fx.cubinhos(e.p, e.cabeca ? 6 : 3, [0.25, 0.26, 0.32], 2.5)
                    fx.faiscas(e.p, e.cabeca ? 7 : 4, [1, 0.3, 0.45], 4, { n: e.n })
                } else {
                    fx.faiscas(e.p, 5, [1, 0.85, 0.5], 4, { n: e.n })
                    fx.brilho(e.p, 0.18, [0.6, 0.5, 0.3], 0.12)
                }
                break
            case "acerto":
                marcarAcerto(e.cabeca, e.morte)
                A.s.acerto(e.cabeca, e.morte)
                break
            case "pontos":
                ganho(e.n)
                break
            case "morreu": {
                conquistar("abate")
                if (jogo.stats.cabecas >= 100) conquistar("cabecas")
                const m = e.e, c = COR_MONSTRO[m.tipo] || [1, 0.2, 0.35]
                const p = [m.x, m.y + m.def.altura * 0.6, m.z]
                if (e.jeito === "boop") {
                    // o Booper não deixa pedaço: uma nuvem de corações e confete
                    for (let i = 0; i < 6; i++) fx.brilho([p[0] + (Math.random() - 0.5) * 0.8, p[1] + Math.random() * 0.8, p[2] + (Math.random() - 0.5) * 0.8], 0.25 + Math.random() * 0.2, [1.2, 0.35, 0.85], 0.7, 22)
                    fx.cubinhos(p, 14, [1, 0.6, 0.9], 3)
                    fx.cubinhos(p, 8, [0.6, 0.9, 1], 3)
                    A.s.morreu(p, "")
                    expressao("coracao", 0.8)
                    break
                }
                // os pedaços: o pelo dele e o vírus brilhando (congelado, estilhaça em gelo)
                const pelo = corRGB(Mod.coresDe(m).pelo)
                fx.cubinhos(p, m.def.grande ? 40 : 16, e.congelado ? [0.7, 0.9, 1.05] : pelo, 3.5)
                fx.cubinhos(p, m.def.grande ? 20 : 6, c, 3)
                if (e.congelado) { fx.brilho(p, 1.2, [0.55, 0.9, 1.3], 0.3, 2); A.s.estilhaco(p) }
                if (e.cabeca) { const ph = [m.x, m.y + m.def.cabeca.y, m.z]; fx.cubinhos(ph, 10, c, 4); fx.brilho(ph, 0.6, c, 0.25) }
                A.s.morreu(p, m.tipo)
                estado.feliz = Math.max(estado.feliz, 0.6)
                if (jogo.stats.abates === 67) expressao("seisSete", 3)
                break
            }
            case "explosao":
                if (e.atomica) {
                    // a bomba: clarão branco, tela tremendo, o anel varrendo tudo
                    fx.brilho(e.p, 30, [1.2, 0.8, 0.3], 1.2, 2)
                    fx.brilho(e.p, 12, [1.3, 1.1, 0.7], 0.8)
                    fx.luz(e.p, [6, 4, 2], 60, 1.2)
                    estado.flash = 1.4
                    estado.tremor = 1.6
                    A.s.atomica()
                    mensagem("BOMBA ATOMICA", e.mortos ? e.mortos + (e.mortos === 1 ? " corrompido vaporizado" : " corrompidos vaporizados") : "", "#ffb03b")
                    if (e.mortos >= 15) conquistar("atomica")
                } else if (e.emp) {
                    fx.brilho(e.p, e.raio * 0.5, [0.3, 0.8, 1], 0.6, 2)
                    fx.brilho(e.p, 3, [0.4, 0.9, 1], 0.4)
                    estado.flash = 0.6
                    A.s.emp()
                } else {
                    const c = e.bomba ? [1.2, 0.55, 0.15] : [1.2, 0.7, 0.3]
                    fx.brilho(e.p, e.raio * 0.9, c, 0.35)
                    fx.brilho(e.p, e.raio * 0.5, [1, 1, 0.9], 0.15)
                    fx.brilho(e.p, e.raio * 0.6, c, 0.5, 2)
                    fx.faiscas(e.p, 30, [1, 0.7, 0.3], 9)
                    fx.fumaca(e.p, 10)
                    fx.cubinhos(e.p, 10, [0.2, 0.2, 0.22], 6)
                    fx.luz(e.p, [4, 2.2, 0.8], e.raio * 3, 0.45)
                    const d = Math.hypot(e.p[0] - j.x, e.p[2] - j.z)
                    estado.tremor = Math.max(estado.tremor, Math.max(0, 1.2 - d / 15))
                    A.s.explosao(e.p, e.raio > 4)
                }
                break
            case "tesla": {
                const b = camAtual ? bocaNoMundo(camAtual) : jogo.olho()
                fx.raio([b].concat(e.pontos), [0.5, 0.8, 1.2], 0.18)
                for (const p of e.pontos) fx.brilho(p, 0.6, [0.5, 0.8, 1.2], 0.2)
                fx.luz(b, [1.5, 2.2, 3], 12, 0.2)
                break
            }
            case "dano":
                estado.sangue = Math.min(1, estado.sangue + 0.55)
                estado.tremor = Math.max(estado.tremor, 0.5)
                estado.ultimoDano = performance.now() / 1000
                if (e.de) indicador(e.de)
                glitch()
                A.s.dano()
                break
            case "onda":
                if (e.g >= 30) conquistar("onda30")
                if (e.especial === "corredores") mensagem("ONDA " + e.n, "ONDA ESPECIAL: AS HIENAS", "#c8ff2e")
                else if (e.especial === "saltadores") mensagem("ONDA " + e.n, "ONDA ESPECIAL: OS SALTADORES", "#ff7b9a")
                else if (e.final) {
                    const ch = PZ.MONSTROS[jogo.nivel.final[0]]
                    mensagem("ONDA " + e.n, ch && ch.chefe ? ch.frases[0] : "ÚLTIMA ONDA DO NÍVEL", "#ff3b5c")
                }
                else mensagem("ONDA " + e.n, "", "#ff3b5c")
                if (!A.trilha.ligada()) A.s.onda(!!e.especial)
                break
            case "fimOnda":
                mensagem("ONDA " + e.n + " SUPERADA", "prepare-se", "#62f3ff")
                A.s.fimOnda()
                break
            case "nivelFim":
                prog.nivelMax = Math.max(prog.nivelMax, jogo.nivelIdx + 1)
                registrarRecorde()
                mostrarNivelFim()
                break
            case "vitoria":
                prog.nivelMax = Math.max(prog.nivelMax, PZ.NIVEIS.length - 1)
                prog.venceu = true
                registrarRecorde()
                A.s.vitoria()
                mostrarVitoria()
                break
            case "morte":
                estado.morteT = 0
                A.s.morte()
                A.trilha.fita()
                break
            case "fim":
                registrarRecorde()
                mostrarFim()
                break
            case "poder":
                if (e.id !== "atomica") mensagem(e.nome, DESC_PODER[e.id] || "", COR_MSG_PODER[e.id] || "#4dff8a")
                A.s.poder()
                expressao("estrelas", 1.5)
                if (e.id === "congelar") A.s.gelo()
                if (e.id === "escudo") A.s.escudo()
                if (e.id === "furia") A.s.furia()
                if (e.id === "recarga") A.s.recarregou()
                estado.feliz = 1.5
                break
            case "poderSurge": A.s.poderSurge([e.p.x, 1, e.p.z]); break
            case "bloqueio": A.s.bloqueio(); estado.escudoHit = 0.35; if (e.de) indicador(e.de); break
            case "poderFim": A.s.poderFim(); break
            case "compra": A.s.compra(); estado.feliz = 1; expressao("cifrao", 1); break
            case "semPontos": A.s.semPontos(); aviso("PONTOS INSUFICIENTES"); expressao("triste", 0.8); break
            case "porta": {
                A.s.porta()
                for (const i of e.porta.ladrilhos) {
                    const x = (i % jogo.mapa.w + 0.5) * PZ.T, z = (Math.floor(i / jogo.mapa.w) + 0.5) * PZ.T
                    fx.fumaca([x, 0.3, z], 4, [0.3, 0.3, 0.33])
                }
                break
            }
            case "caixa":
                if (e.estado === "abre") { A.s.caixa(); expressao("duvida", 3.2) }
                else if (e.estado === "pronta") A.s.caixaPronta()
                break
            case "forja": A.s.forja(); break
            case "forjada":
                A.s.forjada()
                expressao("estrelas", 1.5)
                if (e.nivel >= 4) conquistar("mk4")
                if (e.soElemento) mensagem("ELEMENTO: " + NOME_ELEM[e.elem], e.nome, "#ff4fd8")
                else mensagem(e.nome.toUpperCase(), "melhoria " + ["", "", "Mk II", "Mk III", "Mk IV"][e.nivel] + (e.elem && e.nivel === 3 ? " · elemento " + NOME_ELEM[e.elem] : ""), "#ff4fd8")
                estado.feliz = 1.5
                break
            case "modulo": A.s.modulo(); mensagem("MÓDULO " + e.nome.toUpperCase(), "instalado", "#62f3ff"); break
            case "arma": mensagem(e.nome.toUpperCase(), "", "#62f3ff"); A.s.troca(); expressao("estrelas", 1.2); break
            case "recarga": A.s.recarga(e.arma); break
            case "recarregou": A.s.recarregou(); break
            case "troca": A.s.troca(); break
            case "vazio": A.s.vazio(); aviso("SEM MUNIÇÃO"); expressao("triste", 1.2); break
            case "granada": vm.granada = 0.6; A.s.granada(); break
            case "quica": A.s.quica(e.p); break
            case "garra": A.s.garra(); break
            case "golpe": A.s.golpe(e.acertou); if (e.acertou) estado.tremor = Math.max(estado.tremor, 0.25); break
            case "grunhido": A.s.grunhido([e.e.x, 1.5, e.e.z], e.e.tipo); break
            case "ataque": A.s.ataque([e.e.x, 1.5, e.e.z]); break
            case "surge":
                fx.cubinhos([e.e.x, 0.2, e.e.z], e.e.def.grande ? 20 : 8, COR_MONSTRO[e.e.tipo], 2.5)
                fx.brilho([e.e.x, 0.3, e.e.z], e.e.def.grande ? 2.5 : 1.2, COR_MONSTRO[e.e.tipo], 0.6, 2)
                A.s.surge([e.e.x, 0.5, e.e.z])
                if (e.e.def.chefe) expressao("surpresa", 1.8)
                break
            case "rugido":
                A.s.rugido([e.e.x, 2, e.e.z])
                if (e.e.def.chefe) estado.tremor = Math.max(estado.tremor, 0.4)
                break
            case "pisao": {
                const c = e.gelo ? [0.55, 0.9, 1.3] : jogo.chefe && jogo.chefe.def.cor ? jogo.chefe.def.cor.map((v) => v * 0.6) : [1, 0.3, 1]
                fx.brilho(e.p, e.pequeno ? 2.5 : 4, c, 0.4, 2)
                fx.fumaca(e.p, e.pequeno ? 6 : 12, e.gelo ? [0.5, 0.6, 0.7] : [0.3, 0.2, 0.35])
                fx.cubinhos(e.p, e.pequeno ? 10 : 20, e.gelo ? [0.75, 0.9, 1.0] : [0.25, 0.2, 0.3], 7)
                const d = Math.hypot(e.p[0] - j.x, e.p[2] - j.z)
                estado.tremor = Math.max(estado.tremor, e.pequeno ? Math.max(0, 1 - d / 14) : 1)
                A.s.pisao(e.p)
                break
            }
            case "pancada": A.s.pancada([e.e.x, 1, e.e.z]); fx.fumaca([e.e.x, 1, e.e.z], 5); break
            case "cuspe": A.s.cuspe(e.p); break
            case "respingo": {
                const c = e.acido ? [0.5, 1, 0.25] : e.chefe ? [1, 0.4, 1] : [0.4, 1, 0.5]
                fx.faiscas(e.p, e.acido ? 14 : 8, c, 3)
                fx.brilho(e.p, e.acido ? 1.2 : 0.5, c, 0.25)
                A.s.respingo(e.p)
                break
            }
            case "pavio": A.s.pavio([e.e.x, 1, e.e.z]); break
            case "reiniciando": A.s.reiniciando(); break
            case "reiniciou": A.s.reiniciou(); estado.flash = 0.8; break
            case "chefeFase": mensagem(e.frase, "fase " + e.fase + " de 3", "#c94bff"); break
            case "chefeMorreu": mensagem(e.frase, "", "#ffc93c"); estado.flash = 1; estado.tremor = 1.2; conquistar(e.tipo); break
            case "passo": A.s.passo(e.correndo); break
            case "pulo": A.s.pulo(); break
            case "aterrissa": A.s.aterrissa(); vm.pouso = 1; break
        }
    }
}

// ------------------------------------------------------------------ HUD

const mensagens = []
let msgAte = 0
function mensagem(grande, sub, cor) {
    mensagens.push({ grande: grande, sub: sub, cor: cor })
}

function proximaMensagem(agora) {
    if (agora < msgAte || !mensagens.length) return
    const m = mensagens.shift()
    const el = $("msg")
    el.querySelector(".grande").textContent = limpar(m.grande)
    el.querySelector(".grande").style.color = m.cor
    el.querySelector(".grande").style.textShadow = "0 0 18px " + m.cor + ", 3px 3px 0 #000"
    el.querySelector(".sub").textContent = limpar(m.sub)
    el.classList.remove("mostra")
    void el.offsetWidth
    el.classList.add("mostra")
    msgAte = agora + (mensagens.length ? 1700 : 2400)
    A.s.msg()
}

let avisoAte = 0
function aviso(t) {
    $("aviso").textContent = t
    avisoAte = performance.now() + 1500
}

let acertoAte = 0
function marcarAcerto(cabeca, morte) {
    const el = $("acerto")
    el.className = morte ? "morte" : cabeca ? "cabeca" : ""
    el.style.opacity = "1"
    acertoAte = performance.now() + (morte ? 260 : 140)
}

function ganho(n) {
    const el = document.createElement("span")
    el.textContent = "+" + n
    el.style.left = (Math.random() * 30) + "px"
    $("ganhos").appendChild(el)
    setTimeout(() => el.remove(), 950)
}

const indicadores = []
function indicador(de) {
    const el = document.createElement("b")
    $("indicadores").appendChild(el)
    indicadores.push({ el: el, de: de, vida: 1.3 })
}

function glitch() {
    const g = $("glitch")
    g.innerHTML = ""
    for (let i = 0; i < 5; i++) {
        const b = document.createElement("i")
        b.style.top = (Math.random() * 100) + "%"
        b.style.height = (2 + Math.random() * 10) + "px"
        b.style.transform = "translateX(" + ((Math.random() - 0.5) * 40) + "px)"
        g.appendChild(b)
    }
    g.style.opacity = "1"
    setTimeout(() => { g.style.opacity = "0" }, 90)
}

// O rosto de LED da Protogen no canto: a mesma viseira da Protogen do widget.
// As máscaras são as do avatar protogen-3d (sheets/rosto.js: os olhos, o nariz
// em V e a boca fina com os dentinhos, recortados do modelo 3D — Jakermates,
// CC BY 4.0), pintadas na cor do rosto da textura do Bjorn.
const MASCARAS = new Image()
MASCARAS.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAAGACAYAAABlSWp/AAAI9UlEQVR42u3d/1EbSRqH8S+UA9BFcLoILEdgOQLjCFaOYHEEliM4bwQLEQARgCOAjQBtBCiDvj9oVWk5gaRhRj/Q56maAsNoNPO+z3S/3dMyR6WU4HA5FgICgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAPaKdw1fd5HkPMnlM7/vJTlJ0k8yqdtdkqmQr0QvyaDGbxbDyxfid5LktyRf1n6nUkqT7b48Mn7y82Ep5ayU8lAW81BKOW34noewnS6J3VmN8fxrxvX3903e86jhx8PnX3ST5Fc1sL/i678mOXOj/4NRkj9X3HdSW+CPSYZzPz9a902bCDBIctvCBX+o3QK2GNMmRWC/pYu+rhcu+Y+xaIP+JkYBgxYLnQv5z0WNRVsydS7A+xYvvt/ixe9rtd9v8XjvNyFAr4Mm8JCb/7aF6lyAYcsnPTxgAbYey+MtFYBdH3Nf2Ho8d0GA9wcswPt9E6C3B/3gIdcAa+foWLIOWypPA+Nx8LaZHHD8JwQggAUhOGwB/j7g+P9NAF3AXgng+f3u0+l6gMsO1vXdSVZrTF9Yp9laF3DVwUkfKm1f+9UmaoAbAuzstd9sYk1gL8lDiyd9lMOmzT/a9K91pTreRD+j/99IDBrVZ02Hgb8MAXduKPhrk/MAly2Z+5f8txKDu6at8vErrP3UwohAC/D6GFzVXEw2PRM4zeNn0r4RYGsCfKs5aDyaOGrpL4cO02x9+5H8NxoJTPP4QdBXD8mPWv7TscNq5McsX5kySfIfuU+S3Gf5Wr67WuhdtjkX8y7tT0TcPPmI+DDJv+c+6qz5X3wzPI3NJI9PC286moLvpAVYp6WYkCDzK3n7Hcyy7qwAiAUhIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAEEAICgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACEEAICAACgAA4SN69oWvpJxkl6SV5X78OkkyS/EhytubxRkm+1+PeJZkm+at+PavH3XuOSilv4ToGSa5r0p9jmuSPJD/r94voJTlN8vsKx/pUxdhvSin7sg1KKcMFPx+VUh7K6jyUUs5KKf25Y/Trz9Y9zmjB+Qzrue5FXPcl+bdzgT8rpfSeBPy+NOOibk24fyJkr57bjFsCtLMNn7n7ek+C/7Nsjp8L3n9R6zHc9fge70n/vqivHj/pk09rv9xlcTap73H6pI4YP1MzDNQA7W/juTusv+D3XbUGT+/6+fphxnjf4rmPAsx3C+Ml+9y3kPj7JU35eF+a+0XbPg8Dx0k+J/nwwj69Omb/3PA9rup8wPSFfW7rfmMzgZsXYFonal4ar58kOW9w/PP62umSyafpvib/LUwFf1mx0BqtKcF5fc0qBeoXM4H7wyjJn0v2+dpg2tjDoD3hrCZY8g/4aeBZbbanT2qFL4eW/EPsAhY9QMqbebBDgMazjHeHGoBDFyBWBIEAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAAIAAIAAKAACAACAACgAAgAAgAAoAABAABQAAQAAQAAUAAEAAEAAFAABAABAABQAAQAAQAAUAAEAAEAAFAABAABAABQAAQAAQAAUAAEAAEAAFAABAABMDeC9ATsp2n16UAP5OcivHOclpz1JkAkyT/TTIQ651jUHMzWedFR6WUdZuX2/r9hyRTcd+ZZr9RXtZtAaZJvibpJ7kQ953houbk67o3ZZNRwE2SqyTDJGOx3zrjmourmpt02QXM6Ncmp1etO5OHrTBK8me96z+s2/+/Zh5gkuRH/V5RuN2iLzUXkyYHadoCzLitJ9LYQOS1LfBdjX22MRP4pSa/VwsRE0WbqfhnsZ7WHGRbAkySfJtrktQC3XM21+V+e22re9zSCV3V7z/Xf2sJurnzz2qMU2P+6hvutTXA04mIfv33XZJPJopaTf713J0/aWsirq2ngbMJovkK9X7J6KCXx7nr/oEXc6dLWsxFsfza2s1VSmlzG5d/8lBKGS3Y76SUcj+3z7Dl89iHbVivvdRYnCzYZzS3z4xxm+fRxYXdlv/ntP5uUEq5LosZH1Dyx8/E4LrGKDVmT7lt+1y6uLjeMxLcluVc1te/1cT36jUu47n4tR6btorAZUXLukPLL7WQfGszdxcNa57OiuquloRN6wnfNSyMrus8d9fF123dui5GR/Wadir5XRSBq3YHq3L7TBHZZOvXfvV2yfud1n3beM9RC9ffaZe4iX6vv6CSnedihUDcNxRhlaR3IcNobpRTGl77Q4siblWAWfX/sKDi7c8Nie5bEKFXh1M/VzzeqtzXY54suSNHa1zHcE7S6wXJH2wiN5usgGcSPDc30HthePSSCIP6uuuyOa7rew7WTPxsuNt7Ycy/seR3OQp4qRKeLCloBnlc5PDW1hjc1Rm8uyWjp/4mR0CbFiBrLnX6vcMHS3dJftXvP3Yo3DTJH7u6fG6XBZgN18ZJfmspETdza+cmC95rWJ+2DVsS77ye/2RXA7zrAswYJvlevza5yy8bLJgcJjlp2Drc5HGZ1s2uB3ZfBJhxksd1cP0lST+vSZ+02BKd1JZosMICmct9Cei+CZC5j0B9n2umL19o2rvolmZdxclc9/Ija34siwCvf94wrEmfHvA5HKwAiP8fAAQAAUAAEAAEAAFAABAABAABQAAQAAQAAbCQ/wGQenxhXFB+vQAAAABJRU5ErkJggg=="
MASCARAS.onload = () => { rostoAntes = "" }
const PECA = { olhos: 0, nariz: 1, boca: 2 }
const OLHO_X = [22, 106], OLHO_Y = 45, OLHO_W = 22, OLHO_H = 32
const ROSTO_Y = 22          // o painel do widget tem 128 × 128; o HUD mostra a faixa de 22 a 118
const COR_ROSTO = "#e6e4f2" // o branco-lilás do rosto na textura do Bjorn
const tintas = {}
const rosto = $("rosto").getContext("2d")

/** Uma peça das máscaras na cor pedida; `ky` achata na vertical em volta de `cy` (piscar). */
function pecaRosto(g, n, cor, ky, cy) {
    if (!MASCARAS.complete || !MASCARAS.naturalWidth) return
    const chave = n + cor
    let tinta = tintas[chave]
    if (!tinta) {
        tinta = tintas[chave] = document.createElement("canvas")
        tinta.width = tinta.height = 128
        const t = tinta.getContext("2d")
        t.drawImage(MASCARAS, 0, n * 128, 128, 128, 0, 0, 128, 128)
        t.globalCompositeOperation = "source-in"
        t.fillStyle = cor
        t.fillRect(0, 0, 128, 128)
    }
    g.save()
    if (ky && ky !== 1) { g.translate(0, cy); g.scale(1, ky); g.translate(0, -cy) }
    g.drawImage(tinta, 0, 0)
    g.restore()
}

function tracos(g, pts) {
    g.beginPath()
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    g.stroke()
}

const BOCA_Y = 100

/** ^ ^, do tamanho dos olhos do modelo. */
function olhosFelizes(g) {
    for (const x of OLHO_X) tracos(g, [x - OLHO_W / 2, OLHO_Y + 8, x, OLHO_Y - 10, x + OLHO_W / 2, OLHO_Y + 8])
}

function bochechas(g) {
    g.save(); g.shadowBlur = 0; g.fillStyle = "rgba(255,120,190,0.85)"
    OLHO_X.forEach((x, i) => { g.beginPath(); g.ellipse(x + (i ? -6 : 6), OLHO_Y + 24, 9, 4, 0, 0, Math.PI * 2); g.fill() })
    g.restore()
}

function formaCoracao(g, x, y, r) {
    g.beginPath()
    g.moveTo(x, y + r)
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.9, y - r * 1.3, x, y - r * 0.45)
    g.bezierCurveTo(x + r * 0.9, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r)
    g.fill()
}

function estrela(g, x, y, r) {
    g.beginPath()
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r
        g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q)
    }
    g.closePath()
    g.fill()
}

function letra(g, txt, x, y, tam) {
    g.save()
    g.font = "bold " + tam + "px Segoe UI, Arial, sans-serif"
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(txt, x, y)
    g.restore()
}

function gota(g, x, y) {
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + 7, y + 12, x, y + 16)
    g.quadraticCurveTo(x - 7, y + 12, x, y)
    g.fill()
}

function floco(g, x, y, r) {
    g.save()
    g.lineWidth = 2.5
    for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3
        tracos(g, [x - Math.cos(a) * r, y - Math.sin(a) * r, x + Math.cos(a) * r, y + Math.sin(a) * r])
    }
    g.restore()
}

const ROSTOS = {
    normal(g, cor) { pecaRosto(g, PECA.olhos, cor); pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor) },
    piscar(g, cor) { pecaRosto(g, PECA.olhos, cor, 0.14, OLHO_Y + OLHO_H * 0.3); pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor) },
    // ^ ^ e as bochechas coradas
    feliz(g, cor) { olhosFelizes(g); pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor); bochechas(g) },
    // > <: apanhou
    dor(g, cor) {
        const [a, b] = OLHO_X, w = OLHO_W / 2
        tracos(g, [a - w, OLHO_Y - 10, a + w, OLHO_Y, a - w, OLHO_Y + 10])
        tracos(g, [b + w, OLHO_Y - 10, b - w, OLHO_Y, b + w, OLHO_Y + 10])
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    },
    // os olhos meio fechados, cansada
    triste(g, cor) { pecaRosto(g, PECA.olhos, cor, 0.45, OLHO_Y + OLHO_H * 0.45); pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor) },
    // X X: caiu
    x(g, cor) {
        for (const x of OLHO_X) { tracos(g, [x - 10, OLHO_Y - 10, x + 10, OLHO_Y + 10]); tracos(g, [x + 10, OLHO_Y - 10, x - 10, OLHO_Y + 10]) }
        pecaRosto(g, PECA.nariz, cor)
        tracos(g, [44, BOCA_Y, 84, BOCA_Y])
    },
    // o backup religando: os pontinhos girando
    carregando(g, cor, t) {
        for (let i = 0; i < 6; i++) {
            let u = (t * 0.9 - i * 0.07) % 1
            if (u < 0) u += 1
            const a = -Math.PI / 2 + (u + 0.12 * Math.sin(u * Math.PI * 2)) * Math.PI * 2
            g.beginPath(); g.arc(64 + Math.cos(a) * 20, 70 + Math.sin(a) * 20, 4.5, 0, Math.PI * 2); g.fill()
        }
    },
    // o Uivo: ^ ^, a boca aberta e o som saindo
    uivo(g, cor) {
        olhosFelizes(g)
        pecaRosto(g, PECA.nariz, cor)
        g.beginPath(); g.ellipse(64, BOCA_Y, 12, 10, 0, 0, Math.PI * 2); g.fill()
        for (const r of [22, 29]) {
            g.beginPath(); g.arc(64, BOCA_Y, r, -0.5, 0.5); g.stroke()
            g.beginPath(); g.arc(64, BOCA_Y, r, Math.PI - 0.5, Math.PI + 0.5); g.stroke()
        }
    },
    // as sobrancelhas para baixo e os olhos apertados (a fúria, o chefão)
    brava(g, cor) {
        pecaRosto(g, PECA.olhos, cor, 0.55, OLHO_Y + OLHO_H * 0.45)
        OLHO_X.forEach((x, i) => { const s = i ? -1 : 1; tracos(g, [x - 13 * s, OLHO_Y - 19, x + 12 * s, OLHO_Y - 9]) })
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    },
    // mirando: um olho fechado, o outro apertado
    mirando(g, cor) {
        const x = OLHO_X[0]
        tracos(g, [x - 11, OLHO_Y + 2, x, OLHO_Y + 5, x + 11, OLHO_Y + 2])
        g.save(); g.beginPath(); g.rect(64, 0, 64, 128); g.clip()
        pecaRosto(g, PECA.olhos, cor, 0.5, OLHO_Y + OLHO_H * 0.35)
        g.restore()
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    },
    // as sobrancelhas tortas e a boca tremida (a vida baixa)
    preocupada(g, cor) {
        pecaRosto(g, PECA.olhos, cor, 0.72, OLHO_Y + OLHO_H * 0.25)
        OLHO_X.forEach((x, i) => { const s = i ? -1 : 1; tracos(g, [x - 11 * s, OLHO_Y - 16, x + 11 * s, OLHO_Y - 23]) })
        pecaRosto(g, PECA.nariz, cor)
        tracos(g, [28, BOCA_Y + 2, 40, BOCA_Y - 4, 52, BOCA_Y + 2, 64, BOCA_Y - 4, 76, BOCA_Y + 2, 88, BOCA_Y - 4, 100, BOCA_Y + 2])
    },
    // quase caindo: o alerta piscando com os olhos arregalados
    panico(g, cor, t) {
        if (Math.floor(t * 4) % 2) {
            g.beginPath(); g.moveTo(64, 26); g.lineTo(98, 86); g.lineTo(30, 86); g.closePath(); g.stroke()
            g.fillRect(60, 44, 8, 22); g.fillRect(60, 72, 8, 7)
            return
        }
        for (const x of OLHO_X) { g.beginPath(); g.arc(x, OLHO_Y, 10, 0, Math.PI * 2); g.stroke() }
        pecaRosto(g, PECA.nariz, cor)
        g.beginPath(); g.ellipse(64, BOCA_Y, 16, 10, 0, 0, Math.PI * 2); g.fill()
        gota(g, 116, 26)
    },
    // O O: o chefão chegou
    surpresa(g, cor) {
        for (const x of OLHO_X) {
            g.beginPath(); g.arc(x, OLHO_Y, 13, 0, Math.PI * 2); g.stroke()
            g.beginPath(); g.arc(x, OLHO_Y, 4.5, 0, Math.PI * 2); g.fill()
        }
        pecaRosto(g, PECA.nariz, cor)
        g.beginPath(); g.ellipse(64, BOCA_Y, 7, 9, 0, 0, Math.PI * 2); g.stroke()
    },
    // ♥ ♥: boop, robozinho achado
    coracao(g, cor) {
        for (const x of OLHO_X) formaCoracao(g, x, OLHO_Y, 13)
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
        bochechas(g)
    },
    // ★ ★: poder, arma nova, Forja, conquista
    estrelas(g, cor) {
        for (const x of OLHO_X) estrela(g, x, OLHO_Y, 15)
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    },
    // $ $: comprou
    cifrao(g, cor) {
        for (const x of OLHO_X) letra(g, "$", x, OLHO_Y + 2, 36)
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    },
    // ? ?: a Caixa Glitch girando
    duvida(g, cor) {
        for (const x of OLHO_X) letra(g, "?", x, OLHO_Y + 2, 36)
        pecaRosto(g, PECA.nariz, cor)
        tracos(g, [44, BOCA_Y, 56, BOCA_Y - 3, 70, BOCA_Y + 2, 84, BOCA_Y - 1])
    },
    // ^ ^ e a boca de equalizador: a festa dos robozinhos
    danca(g, cor, t) {
        olhosFelizes(g)
        pecaRosto(g, PECA.nariz, cor)
        for (let k = 0; k < 8; k++) {
            const h = 4 + 16 * Math.abs(Math.sin(t * (2.2 + k * 0.7) + k))
            g.fillRect(25 + k * 10, BOCA_Y + 10 - h, 7, h)
        }
    },
    // o sopro do Urso: tremendo de frio, os dentes batendo
    congelada(g, cor, t) {
        g.save()
        g.translate(Math.sin(t * 40) * 1.5, 0)
        pecaRosto(g, PECA.olhos, cor, 0.6, OLHO_Y + OLHO_H * 0.3)
        pecaRosto(g, PECA.nariz, cor)
        tracos(g, [30, BOCA_Y, 38, BOCA_Y - 4, 46, BOCA_Y, 54, BOCA_Y - 4, 62, BOCA_Y, 70, BOCA_Y - 4, 78, BOCA_Y, 86, BOCA_Y - 4, 94, BOCA_Y])
        g.restore()
        floco(g, 64, 36, 8)
    },
    // parada muito tempo: cochilando
    sono(g, cor, t) {
        for (const x of OLHO_X) { g.beginPath(); g.arc(x, OLHO_Y - 2, 11, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke() }
        pecaRosto(g, PECA.nariz, cor)
        tracos(g, [54, BOCA_Y, 74, BOCA_Y])
        const k = (t * 0.5) % 1
        letra(g, "z", 56 + k * 6, 52 - k * 14, 13)
        letra(g, "Z", 70 + k * 6, 42 - k * 14, 19)
    },
    // o 6 7 (como a Protogen do widget), no abate 67
    seisSete(g, cor) {
        letra(g, "6", OLHO_X[0], OLHO_Y + 2, 34)
        letra(g, "7", OLHO_X[1], OLHO_Y + 2, 34)
        pecaRosto(g, PECA.nariz, cor); pecaRosto(g, PECA.boca, cor)
    }
}

// as que mexem sozinhas: quantas vezes por segundo o painel é redesenhado
const ANIMA = { panico: 4, danca: 10, carregando: 20, congelada: 12, sono: 3 }
const COR_EXPR = { estrelas: "#ffd84a", cifrao: "#4dff8a", coracao: "#ff7bd0", duvida: "#62f3ff", triste: "#ffb03b" }

/** Uma expressão de passagem: um poder, uma compra, um boop… */
function expressao(nome, dur) {
    estado.expr = { nome: nome, ate: performance.now() / 1000 + dur }
}

let rostoAntes = ""
function desenharRosto(t) {
    const j = jogo.jog
    const agora = performance.now() / 1000
    const ex = estado.expr && agora < estado.expr.ate ? estado.expr.nome : null
    let rostoNome = "normal", cor = COR_ROSTO
    if (j.morto) { rostoNome = "x"; cor = "#ff3b5c" }
    else if (j.reiniciando > 0) { rostoNome = "carregando"; cor = "#3bff7a" }
    else if (estado.uivoT > 0) { rostoNome = "uivo"; cor = "#d6a8ff" }
    else if (agora - estado.ultimoDano < 0.6) { rostoNome = "dor"; cor = "#ff6b8a" }
    else if (ex) { rostoNome = ex; cor = COR_EXPR[ex] || COR_ROSTO }
    else if (j.lento > 0) { rostoNome = "congelada"; cor = "#9fe8ff" }
    else if (jogo.festa > 0) { rostoNome = "danca"; cor = "#ff7bd0" }
    else if (j.vida < j.vidaMax * 0.2) { rostoNome = "panico"; cor = "#ff4a4a" }
    else if (estado.feliz > 0) rostoNome = "feliz"
    else if (j.vida < j.vidaMax * 0.4) { rostoNome = "preocupada"; cor = "#ffb03b" }
    else if (jogo.ativos.furia > 0) { rostoNome = "brava"; cor = "#ff4fd8" }
    else if (vm.mira > 0.6) rostoNome = "mirando"
    else if (jogo.chefe && !jogo.chefe.morto) rostoNome = "brava"
    else if ((estado.parado || 0) > 12) { rostoNome = "sono"; cor = "#a09ec8" }
    else if ((t % 4.3) < 0.13) rostoNome = "piscar"
    if (jogo.ativos.critico > 0 && rostoNome === "normal") cor = "#ff4f6d"
    // o Modo Cabeçudo: a viseira passa pelo arco-íris (12 cores, para o cache das tintas não crescer)
    if (PZ.segredos.cabecudo && rostoNome !== "x" && rostoNome !== "dor") cor = "hsl(" + (Math.floor(t * 4) % 12) * 30 + ", 100%, 72%)"
    const chave = rostoNome + cor + (ANIMA[rostoNome] ? Math.floor(t * ANIMA[rostoNome]) : "")
    if (chave === rostoAntes) return
    rostoAntes = chave
    pintarRosto(rosto, rostoNome, cor, t)
}

/** Uma expressão no painel de 128 × 96 (a faixa do meio do painel do widget). */
function pintarRosto(g, nome, cor, t) {
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, 128, 96)
    g.translate(0, -ROSTO_Y)
    g.strokeStyle = g.fillStyle = cor
    g.lineWidth = 5
    g.lineCap = g.lineJoin = "round"
    g.shadowColor = cor
    g.shadowBlur = 4
    ROSTOS[nome](g, cor, t)
    g.restore()
}

const corModulo = { blindagem: "#ff3b3b", backup: "#3bff7a", turbo: "#ffe03b", overclock: "#d03bff", propulsor: "#3b8bff" }
const letraModulo = { blindagem: "H", backup: "B", turbo: "T", overclock: "O", propulsor: "V" }
let hudAntes = {}
function setTexto(id, v) { if (hudAntes[id] !== v) { hudAntes[id] = v; $(id).textContent = limpar(v) } }
function setHTML(id, v) { if (hudAntes[id] !== v) { hudAntes[id] = v; $(id).innerHTML = v } }

function atualizarHUD(t, dt, cam) {
    const j = jogo.jog, s = jogo.armaAtual(), st = jogo.statsAtual()
    // vida em 10 gomos
    const gomos = j.vidaMax > 100 ? 15 : 10
    const cheios = Math.ceil(j.vida / j.vidaMax * gomos)
    let html = ""
    for (let i = 0; i < gomos; i++) html += "<i" + (i < cheios ? "" : ' class="off"') + "></i>"
    setHTML("barraVida", html)
    $("barraVida").classList.toggle("baixa", j.vida < j.vidaMax * 0.4)
    $("folego").firstChild.style.width = (j.folego * 100) + "%"
    let mods = ""
    for (const k of ["blindagem", "backup", "turbo", "overclock", "propulsor"]) {
        const v = j.modulos[k]
        if (!v) continue
        mods += '<b style="background:' + corModulo[k] + ';box-shadow:0 0 8px ' + corModulo[k] + '">' + letraModulo[k] + (k === "backup" && v > 1 ? v : "") + "</b>"
    }
    setHTML("modulos", mods)
    setHTML("onda", (jogo.onda.n || "") + "<small>" + (jogo.onda.n ? "ONDA" : "PREPARE-SE") + "</small>")
    setTexto("pontos", String(j.pontos))

    if (s) {
        setTexto("armaNome", st.nome + (s.elem ? " · " + NOME_ELEM[s.elem] : ""))
        $("armaNome").className = "led" + (s.nivel > 1 ? " n" + s.nivel : "")
        setHTML("municao", s.pente + "<small> / " + (st.infinita ? '<span class="inf">∞</span>' : s.reserva) + "</small>")
        $("municao").classList.toggle("vazio", s.pente === 0)
        setTexto("outra", j.armas.map((a, i) => i === j.sel ? null : "[" + (i + 1) + "] " + PZ.statsArma(a.id, a.nivel).nome).filter(Boolean).join("  "))
        if (jogo.ativos.furia > 0 && performance.now() > avisoAte) $("aviso").textContent = ""
        else if (s.pente <= Math.ceil(st.pente * 0.25) && (s.reserva > 0 || st.infinita) && j.recarga <= 0 && performance.now() > avisoAte) {
            $("aviso").textContent = "RECARREGUE [R]"
        } else if (s.pente === 0 && s.reserva === 0 && performance.now() > avisoAte) $("aviso").textContent = "SEM MUNIÇÃO"
        else if (performance.now() > avisoAte) $("aviso").textContent = ""
    }
    let gr = ""
    for (let i = 0; i < j.granadas; i++) gr += "<i></i>"
    setHTML("granadas", gr)
    $("recarga").hidden = !(j.recarga > 0)
    if (j.recarga > 0) $("recarga").firstChild.style.width = ((1 - j.recarga / j.recargaTotal) * 100) + "%"

    // a mira abre com o espalhamento
    const miraEl = $("mira")
    const mostra = s && !j.correndo && j.troca <= 0 && j.forjando <= 0 && jogo.fase === "jogando" && j.reiniciando <= 0
    if (st) {
        let disp = st.disp + (st.dispMira - st.disp) * j.mira
        disp *= 1 + 0.7 * Math.min(1.5, j.vel / 4.4) * (1 - j.mira)
        if (!j.chao) disp *= 1.8
        if (j.agachado) disp *= 0.7
        const h = tela.clientHeight
        const gap = Math.round(Math.tan(disp) / Math.tan(cam.fov / 2) * h / 2 + 5 + vm.kick * 6)
        const ponto = j.mira > 0.6
        const chave = gap + "|" + ponto + "|" + (st.balas > 1)
        if (hudAntes.mira !== chave) {
            hudAntes.mira = chave
            if (ponto) miraEl.innerHTML = '<i class="p"></i>'
            else if (st.balas > 1) miraEl.innerHTML = '<i class="p"></i><i style="left:' + (-gap - 4) + 'px;top:' + (-gap - 4) + 'px;width:' + (gap * 2 + 8) + 'px;height:' + (gap * 2 + 8) + 'px;border-radius:50%;background:none;border:2px solid rgba(181,251,255,0.8);box-sizing:border-box"></i>'
            else miraEl.innerHTML = '<i class="c" style="top:' + (-gap - 9) + 'px"></i><i class="c" style="top:' + gap + 'px"></i>' +
                                    '<i class="l" style="left:' + (-gap - 9) + 'px"></i><i class="l" style="left:' + gap + 'px"></i><i class="p" style="opacity:0.6"></i>'
        }
    }
    miraEl.style.opacity = mostra && !estado.luneta ? "1" : "0"
    if (performance.now() > acertoAte) $("acerto").style.opacity = "0"

    // a dica do que dá para comprar
    const u = jogo.uso
    if (u && jogo.fase === "jogando" && j.reiniciando <= 0) {
        const custo = u.custo ? '<span class="custo' + (u.pode ? "" : " nao") + '">' + u.custo + "</span>" : ""
        setHTML("dica", (u.acao ? "<kbd>E</kbd>" : "") + u.texto + custo)
        $("dica").hidden = false
    } else $("dica").hidden = true

    // poderes ativos
    let pw = ""
    for (const [k, nome, cor] of [["critico", "CRITICO", "#ff4f6d"], ["dobro", "PONTOS x2", "#ffc93c"], ["escudo", "ESCUDO", "#6b9bff"],
                                  ["congelar", "GELO", "#9fe8ff"], ["furia", "FURIA", "#ff4fd8"], ["vampiro", "VAMPIRO", "#ff3b5c"],
                                  ["drone", "ROBOZINHO", "#c88bff"], ["patas", "PATAS", "#5dffc8"], ["liquidacao", "CAIXA 10", "#ff8bea"]])
        if (jogo.ativos[k] > 0) pw += '<div style="color:' + cor + ";text-shadow:0 0 8px " + cor + '">' + nome + "<br>" + Math.ceil(jogo.ativos[k]) + "</div>"
    setHTML("poderes", pw)
    for (const k of ["critico", "dobro", "escudo", "congelar", "furia", "vampiro", "patas"]) $(k + "Fx").style.opacity = jogo.ativos[k] > 0 ? "1" : "0"
    $("lentoFx").style.opacity = j.lento > 0 ? Math.min(1, j.lento).toFixed(2) : "0"
    // a barra do Uivo (Z)
    $("uivo").firstChild.style.width = (j.uivo * 100) + "%"
    $("uivo").classList.toggle("cheio", j.uivo >= 1)
    estado.escudoHit = Math.max(0, (estado.escudoHit || 0) - dt)
    if (estado.escudoHit > 0) $("escudoFx").style.opacity = "1"

    // o chefe
    const ch = jogo.chefe
    $("chefe").hidden = !ch || ch.morto
    if (ch && !ch.morto) {
        setTexto("chefeNome", ch.def.nome.toUpperCase())
        $("chefe").querySelector("i").style.width = Math.max(0, ch.vida / ch.vidaMax * 100) + "%"
    }

    // sangue: o dano e a vida baixa
    const baixa = Math.max(0, 1 - j.vida / (j.vidaMax * 0.5))
    $("sangue").style.opacity = Math.min(1, estado.sangue + baixa * 0.6).toFixed(3)
    $("flash").style.opacity = Math.min(0.85, estado.flash).toFixed(3)

    // as setas de onde veio o dano
    for (const ind of indicadores) {
        ind.vida -= dt
        const a = Math.atan2(ind.de[0] - j.x, -(ind.de[1] - j.z)) - j.yaw
        ind.el.style.transform = "rotate(" + a + "rad)"
        ind.el.style.opacity = Math.max(0, Math.min(1, ind.vida)).toFixed(2)
        if (ind.vida <= 0) ind.el.remove()
    }
    for (let i = indicadores.length - 1; i >= 0; i--) if (indicadores[i].vida <= 0) indicadores.splice(i, 1)

    $("reinicio").hidden = !(j.reiniciando > 0)
    if (j.reiniciando > 0) $("reinicio").querySelector("i").style.width = ((1 - j.reiniciando / 2.6) * 100) + "%"
    desenharRosto(t)
}

// ------------------------------------------------------------------ telas

function montarMenu() {
    const box = $("niveis")
    box.innerHTML = ""
    PZ.NIVEIS.forEach((nv, i) => {
        const b = document.createElement("button")
        b.className = "botao"
        b.style.width = "auto"
        b.style.minWidth = "96px"
        b.style.padding = "0 12px"
        b.style.fontSize = "12px"
        b.style.whiteSpace = "nowrap"
        const livre = i <= prog.nivelMax
        b.disabled = !livre
        b.textContent = limpar(livre ? (i + 1) + " " + nv.nome : (i + 1) + " ????")
        b.title = livre ? nv.sub : "Vença o nível anterior"
        b.addEventListener("click", () => { A.iniciar(); A.s.menu(); iniciarJogo(i) })
        box.appendChild(b)
    })
    const r = prog.recorde
    $("recorde").textContent = r.ondas ? "RECORDE: " + r.ondas + " ONDAS · " + r.pontos + " PONTOS · " + r.abates + " ABATES" : ""
}

function statsHTML(extra) {
    const s = jogo.stats
    const prec = s.tiros ? Math.round(s.acertos / s.tiros * 100) : 0
    const min = Math.floor(s.tempo / 60), seg = Math.floor(s.tempo % 60)
    const linhas = (extra || []).concat([
        ["Abates", s.abates], ["Tiros na cabeça", s.cabecas], ["Pontos ganhos", s.pontos],
        ["Precisão", prec + "%"], ["Tempo", min + ":" + String(seg).padStart(2, "0")]
    ])
    return linhas.map(([a, b]) => "<span>" + a + "</span><b>" + b + "</b>").join("")
}

function registrarRecorde() {
    const s = jogo.stats, r = prog.recorde
    const ondas = jogo.g0 + Math.max(0, jogo.onda.n - (jogo.fase === "fim" ? 1 : 0))
    if (ondas > r.ondas || (ondas === r.ondas && s.pontos > r.pontos)) {
        r.ondas = ondas; r.pontos = s.pontos; r.abates = s.abates
    }
    gravar()
}

function mostrarNivelFim() {
    $("nivelFimNome").textContent = jogo.nivel.nome + " limpo — a seguir: " + PZ.NIVEIS[jogo.nivelIdx + 1].nome
    $("nivelFimStats").innerHTML = statsHTML([["Ondas", jogo.onda.n]])
    abrirTela("nivelFim")
}

function mostrarVitoria() {
    $("vitoriaStats").innerHTML = statsHTML([["Ondas", jogo.g()]])
    abrirTela("vitoria")
}

function mostrarFim() {
    const ondas = Math.max(0, jogo.onda.n - 1)
    $("fimInfo").textContent = "Nível " + (jogo.nivelIdx + 1) + " — " + jogo.nivel.nome + " · sobreviveu a " + ondas + (ondas === 1 ? " onda" : " ondas")
    $("fimStats").innerHTML = statsHTML()
    abrirTela("fim")
}

function mostrarOpcoes() {
    $("optSens").value = opt.sens; $("vSens").textContent = (+opt.sens).toFixed(2)
    $("optVol").value = opt.vol; $("vVol").textContent = Math.round(opt.vol * 100) + "%"
    $("optMus").value = opt.musica; $("vMus").textContent = opt.musica > 0 ? Math.round(opt.musica * 100) + "%" : "desligada"
    $("optFov").value = opt.fov; $("vFov").textContent = opt.fov + "°"
    $("optRes").value = opt.res; $("vRes").textContent = Math.round(opt.res * 100) + "%"
    $("optInv").checked = !!opt.inv
}

for (const [id, k, conv] of [["optSens", "sens", Number], ["optVol", "vol", Number], ["optMus", "musica", Number], ["optFov", "fov", Number], ["optRes", "res", Number]])
    $(id).addEventListener("input", () => {
        opt[k] = conv($(id).value)
        if (k === "vol") A.volume(opt.vol)
        if (k === "musica") A.trilha.volume(opt.musica)
        mostrarOpcoes(); gravar()
    })
$("optInv").addEventListener("change", () => { opt.inv = $("optInv").checked; gravar() })

const clique = (id, f) => $(id).addEventListener("click", () => { A.iniciar(); A.s.menu(); f() })
clique("jogar", () => iniciarJogo(0))
clique("btnAjuda", () => abrirTela("ajuda", "menu"))
clique("btnConquistas", () => abrirTela("conquistas", "menu"))
clique("conquistasVolta", () => abrirTela("menu"))
clique("btnAjuda2", () => abrirTela("ajuda", "pausa"))
clique("btnOpcoes", () => abrirTela("opcoes", "menu"))
clique("btnOpcoes2", () => abrirTela("opcoes", "pausa"))
clique("ajudaVolta", () => abrirTela(estado.telaVolta || "menu"))
clique("opcoesVolta", () => abrirTela(estado.telaVolta || "menu"))
clique("continuar", () => { fecharTelas(); capturar() })
clique("recomecar", () => { const n = jogo.nivelIdx; iniciarJogo(n) })
clique("paraMenu", () => voltarAoMenu())
clique("proximo", () => { jogo.proximoNivel(); tratarEventos(); vm.reiniciar(); fecharTelas(); capturar() })
clique("nivelFimMenu", () => voltarAoMenu())
clique("infinito", () => { jogo.continuarInfinito(); mensagem("ONDAS SEM FIM", "até onde a viseira aguenta?", "#ffc93c"); fecharTelas(); capturar() })
clique("vitoriaMenu", () => voltarAoMenu())
clique("denovo", () => iniciarJogo(jogo.nivelIdx))
clique("fimMenu", () => voltarAoMenu())
clique("sair", fechar)
$("fechar").addEventListener("click", fechar)

function voltarAoMenu() {
    if (jogo && jogo.fase === "jogando") registrarRecorde()
    estado.jogando = false
    A.pararAmbiente()
    abrirTela("menu")
}

// No site (srbjorn.github.io) o jogo roda dentro de uma janela da página: o × avisa a página.
const embutido = (() => { try { return window.parent !== window } catch (e) { return true } })()
function avisarSite(msg) { try { window.parent.postMessage(Object.assign({ pz: "" }, msg), "*") } catch (e) { /* sem página em volta */ } }

function fechar() {
    gravar()
    const a = api()
    if (host && a) a.fechar()
    else if (embutido) { soltar(); avisarSite({ pz: "fechar" }) }
    else if (!host) { try { window.close() } catch (e) { /* aberto à mão: fica */ } }
}

// Tela cheia: no site, quem fica em tela cheia é a janela da página (ela avisa de volta); sozinho, a própria página.
function alternarTelaCheia() {
    if (embutido) { avisarSite({ pz: "tela-cheia" }); return }
    const d = document
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen() }
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {})
}
function marcarCheia(v) { const b = $("telaCheia"); b.classList.toggle("cheia", !!v); b.title = v ? "Sair da tela cheia" : "Tela cheia" }
$("telaCheia").addEventListener("click", alternarTelaCheia)
document.addEventListener("fullscreenchange", () => { if (!embutido) marcarCheia(!!document.fullscreenElement) })
window.addEventListener("message", (ev) => { if (ev.source === window.parent && ev.data && ev.data.pz === "cheia") marcarCheia(ev.data.valor) })

/** A faixa do título arrasta a janela (menos o botão de fechar). */
function avisarBarra() {
    const a = api()
    if (!host || !a) return
    a.set_drag_bar($("titulo").offsetHeight, $("fechar").offsetWidth, window.devicePixelRatio || 1)
}
window.addEventListener("pywebviewready", avisarBarra)
window.addEventListener("resize", avisarBarra)

// ------------------------------------------------------------------ o laço

let antes = performance.now()
let quadros = 0, fpsDesde = 0
const PASSO = 1 / 60

function entrada(primeiro) {
    const tem = (k) => teclas.has(k)
    const pul = (k) => primeiro && pulsos.has(k)
    if (travaMouse) {
        if (!tem(K.ESQ) && !tem(K.DIR)) travaMouse = false
    }
    const mouse = (k) => !travaMouse && tem(k)
    const mousePul = (k) => !travaMouse && pul(k)
    const sens = 0.0022 * opt.sens * (1 - 0.4 * vm.mira)
    let arma = null
    if (pul(K.UM)) arma = 0
    if (pul(K.DOIS)) arma = 1
    if (pul(K.TRES)) arma = 2
    const ent = {
        frente: (tem(K.W) ? 1 : 0) - (tem(K.S) ? 1 : 0),
        lado: (tem(K.D) ? 1 : 0) - (tem(K.A) ? 1 : 0),
        correr: tem(K.SHIFT), agachar: tem(K.CTRL) || tem(K.C),
        mirar: mouse(K.DIR), atirar: mouse(K.ESQ), atirarPulso: mousePul(K.ESQ),
        pular: pul(K.ESPACO), recarregar: pul(K.R), usar: pul(K.E) || pul(K.F),
        corpo: pul(K.V) || mousePul(K.MEIO), granada: pul(K.G),
        trocar: pul(K.Q) || (primeiro && roda !== 0), arma: arma, uivo: pul(K.Z),
        dYaw: primeiro ? movX * sens : 0, dPitch: primeiro ? -movY * sens * (opt.inv ? -1 : 1) : 0
    }
    return ent
}

/** A altura da trilha: 0 calada, 1 entre as ondas, 2 na onda, 3 com o chefão. */
function alturaDaTrilha() {
    if (!jogo || !estado.jogando || jogo.fase !== "jogando" || jogo.festa > 0) return 0
    if (jogo.chefe && !jogo.chefe.morto) return 3
    return jogo.onda.estado === "ativa" ? 2 : 1
}

function passo(agora) {
    requestAnimationFrame(passo)
    quadro(agora)
}

function quadro(agora) {
    // o relógio nunca anda para trás (um passo negativo faria os efeitos crescerem)
    let dt = Math.max(0, Math.min(0.1, (agora - antes) / 1000))
    antes = agora
    if (!R) return
    const t = agora / 1000

    // atalhos que valem em qualquer hora
    if (pulsos.has(K.F3)) { estado.fps = !estado.fps; $("fps").hidden = !estado.fps }
    if (host && estado.tela === "pausa" && pulsos.has(K.ESC) && agora - estado.telaDesde > 350) { fecharTelas(); capturar() }

    if (jogo && estado.jogando) {
        const ativo = estado.tela === null && (capturado || estado.teste)
        if (ativo && (jogo.fase === "jogando" || jogo.fase === "morrendo")) {
            if (pulsos.has(K.L)) estado.lanterna = !estado.lanterna
            const n = Math.max(1, Math.min(6, Math.round(dt / PASSO)))
            const dYaw = movX, dPitch = movY
            for (let i = 0; i < n; i++) {
                const ent = entrada(i === 0)
                jogo.passo(dt / n, ent)
                tratarEventos()
            }
            vm.passo(dt, dYaw * 0.0022 * opt.sens, -dPitch * 0.0022 * opt.sens)
            estado.parado = teclas.size || dYaw || dPitch ? 0 : (estado.parado || 0) + dt
            if (jogo.fase === "morrendo" || jogo.fase === "fim") estado.morteT += dt
        } else if (jogo.fase === "morrendo") {
            jogo.passo(dt, {})
            tratarEventos()
            estado.morteT += dt
        }
        R.fx.atualizar(estado.tela === null ? dt : 0, jogo.mapa)
        estado.tremor = Math.max(0, estado.tremor - dt * 2.2)
        estado.sangue = Math.max(0, estado.sangue - dt * 0.8)
        estado.flash = Math.max(0, estado.flash - dt * 1.8)
        estado.feliz = Math.max(0, estado.feliz - dt)
        estado.uivoT = Math.max(0, (estado.uivoT || 0) - dt)

        const j = jogo.jog
        if (jogo.fase === "jogando" && estado.tela === null) {
            estado.bipe = (estado.bipe || 0) - dt
            if (estado.bipe <= 0) {
                estado.bipe = 3.2
                for (const o of jogo.mapa.objetos)
                    if (o.tipo === "robozinho" && !o.achado && !o.pelucia && Math.hypot(o.cx - j.x, o.cz - j.z) < 10) { A.s.bipe([o.cx, o.base + 0.3, o.cz]); break }
            }
        }
        if (!j.morto && j.vida < j.vidaMax * 0.35 && jogo.fase === "jogando") {
            estado.coracao -= dt
            if (estado.coracao <= 0) { A.s.coracao(); estado.coracao = 0.9 }
        }

        const cam = camera(t)
        camAtual = cam
        A.ouvinte.x = cam.olho[0]; A.ouvinte.y = cam.olho[1]; A.ouvinte.z = cam.olho[2]; A.ouvinte.yaw = cam.yaw
        // a luneta do Ferrão: mirando, a tela vira a luneta e a mão some
        const sa = jogo.armaAtual()
        const luneta = !!sa && sa.id === "ferrao" && vm.mira > 0.85 && !j.morto && j.reiniciando <= 0
        $("luneta").hidden = !luneta
        estado.luneta = luneta
        const vmItens = luneta ? [] : vm.montar(t)
        let clarao = null
        if (vm.clarao > 0 && vm.bocaCam && !luneta) {
            const s = sa
            const cor = s && s.id === "fornalha" ? [1.3, 0.6, 0.2] : s && s.id === "nevasca" ? [0.6, 0.9, 1.3] : s && s.id === "booper" ? [1.3, 0.45, 1.0] : COR_NIVEL[(s ? s.nivel : 1) - 1]
            clarao = { p: vm.bocaCam, tam: s && (s.id === "estilhaco" || s.id === "tempestade" || s.id === "uivo") ? 0.13 : s && s.id === "fornalha" ? 0.07 : 0.09,
                       cor: [cor[0], cor[1], cor[2], 1], rot: vm.claraoRot }
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2) * opt.res
        R.tamanho(Math.max(1, Math.round(tela.clientWidth * dpr)), Math.max(1, Math.round(tela.clientHeight * dpr)))
        const sat = jogo.fase === "morrendo" || jogo.fase === "fim" ? Math.max(0.15, 1 - estado.morteT) : j.reiniciando > 0 ? 0.3 : 1
        R.quadro({ cam: cam, jogo: jogo, t: t, vm: vmItens, fovVM: FOV_VM, clarao: clarao, lanterna: estado.lanterna, saturacao: sat })
        atualizarHUD(t, dt, cam)
        proximaMensagem(agora)
    } else if (R && fundo) {
        // a tela de título: o laboratório girando devagar, sem ninguém
        fundo.jog.yaw += dt * 0.06
        R.fx.atualizar(dt, fundo.mapa)
        const cam = { olho: fundo.olho(), yaw: fundo.jog.yaw, pitch: -0.05, fov: 75 * Math.PI / 180 }
        R.tamanho(Math.max(1, Math.round(tela.clientWidth * Math.min(window.devicePixelRatio || 1, 2) * opt.res)),
                  Math.max(1, Math.round(tela.clientHeight * Math.min(window.devicePixelRatio || 1, 2) * opt.res)))
        if (R.mapa !== fundo.mapa) R.construirNivel(fundo.mapa, fundo.nivel)
        R.quadro({ cam: cam, jogo: fundo, t: t, vm: [], lanterna: false })
    }

    A.trilha.alvo(alturaDaTrilha())
    A.trilha.abafar(estado.jogando && estado.tela !== null)

    quadros++
    if (agora - fpsDesde > 500) {
        if (estado.fps) $("fps").textContent = Math.round(quadros * 1000 / (agora - fpsDesde)) + " qps"
        quadros = 0
        fpsDesde = agora
    }
    movX = movY = 0
    roda = 0
    pulsos.clear()
}

// ------------------------------------------------------------------ começo

let fundo = null

function comecar() {
    try {
        R = new PZ.Render(tela)
    } catch (e) {
        $("carregando").textContent = "Este computador não abriu o 3D (WebGL): " + e.message
        return
    }
    A.volume(opt.vol)
    A.trilha.volume(opt.musica)
    setTimeout(() => {
        fundo = new PZ.Jogo({ semente: 3 })
        fundo.novoJogo(0)
        fundo.eventos.length = 0
        fundo.jog.x = 17 * PZ.T; fundo.jog.z = 15.5 * PZ.T
        if (!bancada()) abrirTela("menu")
        avisarBarra()
    }, 30)
    requestAnimationFrame(passo)
}

/**
 * A bancada de teste: `jogo.html?teste` entra direto no jogo, sem menu e sem
 * prender o mouse, para os retratos saírem iguais. `&nivel=0..2`, `&deus=1`,
 * `&onda=N` (começa nela), `&pos=x,z` (ladrilho), `&olhar=yaw,pitch` (graus),
 * `&arma=id:nivel`, `&monstros=tipo:n`, `&rodar=seg` (simula antes),
 * `&tela=menu|pausa|fim|nivelFim|vitoria|ajuda|opcoes`, `&segurar=87,1`.
 * Expõe `window.__pz` para os testes no navegador.
 */
function bancada() {
    const q = new URLSearchParams(location.search)
    if (!q.has("teste")) return false
    estado.teste = true
    estado.deus = q.get("deus") === "1"
    const nivel = Number(q.get("nivel") || 0)
    jogo = new PZ.Jogo({ semente: Number(q.get("semente") || 5), deus: estado.deus })
    jogo.novoJogo(nivel)
    estado.jogando = true
    tratarEventos()
    fecharTelas()
    capturado = true
    const nums = (k) => (q.get(k) || "").split(",").map(Number)
    if (q.has("onda")) { jogo.onda.n = Number(q.get("onda")) - 1; jogo.onda.timer = 0.05 }
    if (q.has("pos")) { const p = nums("pos"); jogo.jog.x = (p[0] + 0.5) * PZ.T; jogo.jog.z = (p[1] + 0.5) * PZ.T }
    if (q.has("olhar")) { const o = nums("olhar"); jogo.jog.yaw = o[0] * Math.PI / 180; jogo.jog.pitch = (o[1] || 0) * Math.PI / 180 }
    if (q.has("arma")) {
        const [id, nv] = q.get("arma").split(":")
        const st = PZ.statsArma(id, Number(nv || 1))
        jogo.jog.armas[0] = { id: id, nivel: Number(nv || 1), pente: st.pente, reserva: st.reserva }
    }
    if (q.has("pontos")) jogo.jog.pontos = Number(q.get("pontos"))
    if (q.has("segurar")) definirTeclas(nums("segurar"))
    const rodar = (seg) => {
        for (let i = 0; i < seg * 60; i++) { jogo.passo(1 / 60, entrada(i === 0)); tratarEventos(); R.fx.atualizar(1 / 60, jogo.mapa) }
    }
    if (q.has("monstros")) {
        for (const par of q.get("monstros").split(";")) {
            const [tipo, n] = par.split(":")
            jogo.onda.estado = "ativa"
            for (let i = 0; i < Number(n || 1); i++) jogo.surgir(tipo)
        }
    }
    if (q.has("rodar")) rodar(Number(q.get("rodar")))
    if (q.has("tela")) {
        const tl = q.get("tela")
        if (tl === "fim") mostrarFim()
        else if (tl === "nivelFim") mostrarNivelFim()
        else if (tl === "vitoria") mostrarVitoria()
        else { if (tl === "menu") estado.jogando = false; abrirTela(tl, "menu") }
    }
    window.__pz = { get jogo() { return jogo }, R: R, rodar: rodar, estado: estado, vm: vm, quadro: quadro,
                    tecla(lista) { definirTeclas(lista) }, mover(dx, dy) { movX += dx; movY += dy },
                    /** Todas as expressões numa folha, por cima de tudo (para conferir o desenho). */
                    rostos(t) {
                        const nomes = Object.keys(ROSTOS), cv = document.createElement("canvas")
                        cv.width = 5 * 140; cv.height = Math.ceil(nomes.length / 5) * 122
                        cv.style.cssText = "position:fixed;left:0;top:0;z-index:99;background:#05050a"
                        const g = cv.getContext("2d"), um = document.createElement("canvas")
                        um.width = 128; um.height = 96
                        nomes.forEach((n, i) => {
                            const x = (i % 5) * 140 + 6, y = Math.floor(i / 5) * 122 + 4
                            pintarRosto(um.getContext("2d"), n, COR_EXPR[n] || COR_ROSTO, t || 1.3)
                            g.fillStyle = "#000"; g.fillRect(x, y, 128, 96)
                            g.drawImage(um, x, y)
                            g.fillStyle = "#aaa"; g.font = "12px sans-serif"; g.fillText(n, x + 2, y + 112)
                        })
                        document.body.appendChild(cv)
                        return nomes
                    } }
    return true
}

comecar()

})(window.PZ = window.PZ || {})
