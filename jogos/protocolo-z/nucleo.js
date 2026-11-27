/*
 * Protocolo Z — o núcleo: mapa, física, armas, monstros, ondas e pontos.
 *
 * Sem tela e sem som. Quem desenha e toca (render.js, audio.js, jogo.js) lê o
 * estado e os `eventos` que cada `passo` deixa — e é por isso que o jogo
 * inteiro roda no Node, onde testes/teste.js joga ondas e níveis inteiros com
 * um robô atrás de travamentos, NaN e monstro preso.
 *
 * Unidades: metros e segundos. y para cima; o mapa é uma grade de ladrilhos
 * de T metros no plano xz (coluna = x, linha = z). O ângulo `yaw` 0 olha para
 * -z e cresce para a direita.
 */
(function (PZ) {
"use strict"

const T = 2
const RAIO_JOG = 0.34
const OLHO = 1.62, OLHO_AGACHADO = 1.08
const GRAVIDADE = 16

PZ.T = T
// Os segredos que valem para a partida inteira (o código Konami liga o cabeçudo).
PZ.segredos = PZ.segredos || { cabecudo: false }
const CABECUDO = 1.9

// ------------------------------------------------------------------ sorteio

function sorteio(semente) {
    let a = semente >>> 0
    return function () {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

function angDif(a, b) {
    let d = (b - a) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return d
}

// ------------------------------------------------------------------ armas
//
// `cad` é o tempo entre tiros; `disp`, o raio do cone (em radianos) com a
// arma na cintura, e `dispMira`, mirando. A Forja multiplica pelo `NIVEL`.

const ARMAS = {
    faisca: {
        nomes: ["Faísca P-1", "Faísca Dupla", "Faísca Ômega", "Faísca Suprema"], modo: "semi",
        dano: 45, balas: 1, cad: 0.15, pente: 10, reserva: 80, recarga: 1.3,
        disp: 0.012, dispMira: 0.002, cabeca: 2.5, recuo: 0.014, peso: 1, preco: 0, umaMao: true,
        infinita: true      // a arma do começo nunca fica sem reserva: só recarrega
    },
    uivo: {
        nomes: ["Uivo .50", "Uivo Lunar", "Uivo Eclipse", "Uivo Ancestral"], modo: "semi",
        dano: 170, balas: 1, cad: 0.3, pente: 6, reserva: 54, recarga: 2.0,
        disp: 0.01, dispMira: 0.001, cabeca: 3, recuo: 0.055, peso: 1, preco: 750, umaMao: true
    },
    enxame: {
        nomes: ["Enxame SMG", "Enxame Colmeia", "Enxame Rainha", "Enxame Imperial"], modo: "auto",
        dano: 34, balas: 1, cad: 0.07, pente: 32, reserva: 224, recarga: 1.9,
        disp: 0.03, dispMira: 0.01, cabeca: 2.2, recuo: 0.007, peso: 0.97, preco: 1000
    },
    estilhaco: {
        nomes: ["Estilhaço 12", "Estilhaço Fractal", "Estilhaço Supremo", "Estilhaço Cataclisma"], modo: "semi",
        dano: 30, balas: 9, cad: 0.72, pente: 6, reserva: 48, recarga: 2.4,
        disp: 0.085, dispMira: 0.06, cabeca: 1.5, recuo: 0.05, peso: 0.95, preco: 1200
    },
    lanca: {
        nomes: ["Lança AR-7", "Lança Hélice", "Lança Estelar", "Lança Galáctica"], modo: "auto",
        dano: 60, balas: 1, cad: 0.1, pente: 30, reserva: 210, recarga: 2.2,
        disp: 0.022, dispMira: 0.003, cabeca: 2.5, recuo: 0.011, peso: 0.94, preco: 1500, zoom: 0.55
    },
    ferrao: {
        nomes: ["Ferrão SR", "Ferrão Vespa", "Ferrão Rainha", "Ferrão Imperial"], modo: "semi",
        dano: 950, balas: 1, cad: 1.05, pente: 5, reserva: 35, recarga: 3.0,
        disp: 0.06, dispMira: 0, cabeca: 3, recuo: 0.08, peso: 0.9, perfura: true, preco: 2000, zoom: 0.3
    },
    tempestade: {
        nomes: ["Tempestade LMG", "Tempestade Ciclone", "Tempestade Eterna", "Tempestade Primordial"], modo: "auto",
        dano: 70, balas: 1, cad: 0.085, pente: 100, reserva: 400, recarga: 4,
        disp: 0.04, dispMira: 0.012, cabeca: 2, recuo: 0.01, peso: 0.86, caixa: 1
    },
    gama: {
        nomes: ["Raio Gama", "Raio Gama²", "Raio Gama∞", "Raio Gama Ω"], modo: "semi",
        dano: 700, balas: 1, cad: 1, pente: 5, reserva: 35, recarga: 2.8,
        disp: 0.002, dispMira: 0, cabeca: 2, recuo: 0.06, peso: 0.9, perfura: true, caixa: 1, zoom: 0.55
    },
    supernova: {
        nomes: ["Supernova", "Hipernova", "Big Bang", "Singularidade"], modo: "semi",
        dano: 520, balas: 1, cad: 0.9, pente: 4, reserva: 24, recarga: 2.6, raio: 4.5,
        disp: 0.006, dispMira: 0.002, cabeca: 1, recuo: 0.06, peso: 0.9, projetil: 32, caixa: 0.8
    },
    tesla: {
        nomes: ["Bobina Tesla", "Bobina Tempestuosa", "Bobina de Zeus", "Bobina de Thor"], modo: "semi",
        dano: 2600, balas: 1, cad: 0.85, pente: 4, reserva: 28, recarga: 2.6, corrente: 6,
        disp: 0, dispMira: 0, cabeca: 1, recuo: 0.04, peso: 0.92, caixa: 0.5
    },
    // o lança-chamas: queima tudo num cone curto (`chamas` é o alcance) e deixa pegando fogo
    fornalha: {
        nomes: ["Fornalha", "Fornalha Infernal", "Fornalha Solar", "Fornalha Primordial"], modo: "auto",
        dano: 26, balas: 1, cad: 0.06, pente: 120, reserva: 360, recarga: 3.0, chamas: 7.5,
        disp: 0, dispMira: 0, cabeca: 1, recuo: 0.002, peso: 0.92, caixa: 0.9
    },
    // a arma maravilha (segredo): corações que atravessam a fila dando "boop" —
    // os comuns caem na hora, os grandes ficam tontos. Vem dos 3 robozinhos
    // escondidos de cada nível, ou (raro) da Caixa Glitch.
    booper: {
        nomes: ["Booper 3000", "Booper Turbo", "Booper Supremo", "Booper Infinito"], modo: "semi",
        dano: 1600, balas: 1, cad: 0.5, pente: 8, reserva: 48, recarga: 2.2, boop: 18,
        disp: 0.004, dispMira: 0, cabeca: 1, recuo: 0.03, peso: 1, caixa: 0.12
    },
    // o raio de gelo: atravessa, deixa lento e, com `frio` acumulado, congela
    nevasca: {
        nomes: ["Nevasca", "Nevasca Polar", "Nevasca Boreal", "Zero Absoluto"], modo: "auto",
        dano: 55, balas: 1, cad: 0.08, pente: 60, reserva: 240, recarga: 2.6, frio: 0.22,
        disp: 0.004, dispMira: 0.001, cabeca: 1.5, recuo: 0.003, peso: 0.94, perfura: true, caixa: 0.9
    }
}
// o que a Forja faz a cada nível (o 1 é a arma como vem)
const NIVEL = [null,
    { dano: 1, pente: 1, reserva: 1, cad: 1, corrente: 0, raio: 0, alcance: 0 },
    { dano: 2.2, pente: 1.5, reserva: 1.5, cad: 0.92, corrente: 3, raio: 0.8, alcance: 0.6 },
    { dano: 3.8, pente: 2, reserva: 2, cad: 0.84, corrente: 7, raio: 1.6, alcance: 1.2 },
    { dano: 5.6, pente: 2.5, reserva: 2.5, cad: 0.78, corrente: 10, raio: 2.4, alcance: 1.8 }]
const MAX_NIVEL = 4
const PRECO_FORJA = [0, 2500, 4000, 6500]   // para o Mk II, o Mk III e o Mk IV
const PRECO_ELEMENTO = 2000                  // trocar o elemento de uma arma Mk IV
const PRECO_CAIXA = 950

// No Mk III a arma ganha um elemento (sorteado); no Mk IV ele pega mais vezes.
const ELEMENTOS = {
    fogo: { nome: "FOGO" },
    gelo: { nome: "GELO" },
    choque: { nome: "CHOQUE" }
}

function statsArma(id, nivel) {
    const a = ARMAS[id], m = NIVEL[nivel]
    return {
        id: id, nivel: nivel, nome: a.nomes[nivel - 1], modo: a.modo,
        dano: a.dano * m.dano, balas: a.balas, cad: a.cad * m.cad,
        pente: Math.round(a.pente * m.pente), reserva: Math.round(a.reserva * m.reserva),
        recarga: a.recarga, disp: a.disp, dispMira: a.dispMira, cabeca: a.cabeca,
        recuo: a.recuo, peso: a.peso, perfura: !!a.perfura, projetil: a.projetil || 0,
        raio: a.raio ? a.raio + m.raio : 0, corrente: a.corrente ? a.corrente + m.corrente : 0,
        chamas: a.chamas ? a.chamas + m.alcance : 0, frio: a.frio || 0, boop: a.boop || 0,
        infinita: !!a.infinita, umaMao: !!a.umaMao, zoom: a.zoom || 0.75
    }
}

function precoMunicao(id, nivel) {
    return nivel > 1 ? 2000 : Math.floor((ARMAS[id].preco || 1000) / 2)
}

// ------------------------------------------------------------------ módulos e poderes

const MODULOS = {
    H: { id: "blindagem", nome: "Blindagem", preco: 2500, desc: "aguenta 2,5× mais dano" },
    B: { id: "backup", nome: "Backup", preco: 500, desc: "volta uma vez depois de cair", max: 3 },
    T: { id: "turbo", nome: "Turbo", preco: 3000, desc: "recarrega na metade do tempo" },
    O: { id: "overclock", nome: "Overclock", preco: 2000, desc: "atira 33% mais rápido" },
    V: { id: "propulsor", nome: "Propulsor", preco: 2000, desc: "corre mais e por mais tempo" },
    K: { id: "coldre", nome: "Coldre Extra", preco: 4000, desc: "carrega uma terceira arma" },
    J: { id: "presas", nome: "Presas de Titânio", preco: 1500, desc: "golpe de garra 4× mais forte" }
}

// Os poderes que os monstros soltam. `dura`: os que valem por um tempo.
const PODERES = {
    municao: { nome: "MUNIÇÃO MÁXIMA", peso: 20 },
    recarga: { nome: "RECARGA TOTAL", peso: 16 },
    critico: { nome: "DANO CRÍTICO", peso: 14, dura: 20 },
    dobro: { nome: "PONTOS EM DOBRO", peso: 14, dura: 20 },
    atomica: { nome: "BOMBA ATÔMICA", peso: 9 },
    escudo: { nome: "ESCUDO DE PLASMA", peso: 9, dura: 12 },
    congelar: { nome: "CONGELAMENTO", peso: 9, dura: 8 },
    furia: { nome: "FÚRIA", peso: 9, dura: 15 },
    bonus: { nome: "BÔNUS DE PONTOS", peso: 10 },
    vampiro: { nome: "PRESAS VAMPIRAS", peso: 9, dura: 20 },
    drone: { nome: "ROBOZINHO ALIADO", peso: 8, dura: 25 },
    patas: { nome: "PATAS LIGEIRAS", peso: 9, dura: 20 },
    liquidacao: { nome: "LIQUIDAÇÃO GLITCH", peso: 6, dura: 30 },
    vida: { nome: "BACKUP EXTRA", peso: 4 },
    // não cai de monstro: é o prêmio dos 3 robozinhos escondidos
    booper: { nome: "BOOPER 3000", peso: 0, segredo: true }
}
// A Bomba Atômica mata todos os comuns; nos grandes, tira esta fração da vida
// (por nível: quanto mais fundo, mais eles aguentam). O chefe só sente um pouco.
const ATOMICA_GRANDES = [0.6, 0.5, 0.42, 0.35, 0.3]
const ATOMICA_CHEFE = 0.12
const MAX_BACKUP = 5

// ------------------------------------------------------------------ monstros
//
// `vida` multiplica a vida da onda (`vidaBase`). As esferas são os alvos dos
// tiros: `y` a altura do centro, `f` quanto ela vai para a frente do corpo.

const MONSTROS = {
    // o zumbi comum: um furry de laboratório (lobo, raposa, gato ou cachorro) de jaleco
    // rasgado, ou um protogen corrompido (o robô de viseira vermelha, ou o branco)
    corrompido: {
        nome: "Corrompido", vida: 1, raio: 0.36, altura: 1.85, alcance: 0.85,
        preparo: 0.42, recupera: 0.55, dano: 1, pontos: 60, surge: 1.1, variantes: 6,
        protogens: [4, 5],      // as variantes que são protogens (modelos.js, VARIANTES): a garra neles é boop
        cabeca: { y: 1.63, f: 0.12, r: 0.22 }, corpo: [{ y: 1.15, f: 0.04, r: 0.33 }, { y: 0.55, f: 0, r: 0.29 }]
    },
    // a hiena: magra, curvada, corre muito
    corredor: {
        nome: "Hiena", vida: 0.6, raio: 0.33, altura: 1.55, alcance: 0.8, vel: 4.7,
        preparo: 0.28, recupera: 0.4, dano: 0.7, pontos: 70, surge: 0.8,
        cabeca: { y: 1.3, f: 0.32, r: 0.2 }, corpo: [{ y: 0.95, f: 0.15, r: 0.3 }, { y: 0.45, f: 0, r: 0.26 }]
    },
    // o guaxinim inchado: corre até você e estoura
    bomba: {
        nome: "Inchado", vida: 0.75, raio: 0.45, altura: 1.4, alcance: 1.2, vel: 3.1,
        preparo: 0.75, recupera: 0, dano: 0, pontos: 80, surge: 1.0,
        cabeca: { y: 1.24, f: 0.08, r: 0.2 }, corpo: [{ y: 0.72, f: 0, r: 0.5 }]
    },
    // o lagarto: cospe ácido de longe
    cuspidor: {
        nome: "Lagarto", vida: 0.9, raio: 0.36, altura: 2.0, alcance: 0.85, vel: 2.1,
        preparo: 0.45, recupera: 0.55, dano: 0.9, pontos: 90, surge: 1.2,
        cabeca: { y: 1.76, f: 0.12, r: 0.23 }, corpo: [{ y: 1.25, f: 0, r: 0.32 }, { y: 0.6, f: 0, r: 0.28 }]
    },
    // o coelho: agacha e dá o bote de longe
    saltador: {
        nome: "Saltador", vida: 0.7, raio: 0.33, altura: 1.75, alcance: 0.8, vel: 3.0,
        preparo: 0.32, recupera: 0.5, dano: 0.8, pontos: 80, surge: 0.9,
        cabeca: { y: 1.38, f: 0.1, r: 0.2 }, corpo: [{ y: 0.98, f: 0.05, r: 0.3 }, { y: 0.5, f: 0, r: 0.27 }]
    },
    // o lobo uivador: o uivo deixa os outros mais rápidos
    uivador: {
        nome: "Uivador", vida: 1.1, raio: 0.36, altura: 1.95, alcance: 0.85, vel: 1.7,
        preparo: 0.42, recupera: 0.55, dano: 1, pontos: 100, surge: 1.2,
        cabeca: { y: 1.7, f: 0.14, r: 0.22 }, corpo: [{ y: 1.2, f: 0.04, r: 0.32 }, { y: 0.6, f: 0, r: 0.28 }]
    },
    // o touro: avisa (rugido) e investe
    brutamonte: {
        nome: "Touro", vida: 8, raio: 0.7, altura: 2.6, alcance: 1.0, vel: 1.75,
        preparo: 0.6, recupera: 0.7, dano: 1.25, pontos: 500, surge: 2.0, grande: true,
        cabeca: { y: 2.18, f: 0.3, r: 0.32 }, corpo: [{ y: 1.65, f: 0.1, r: 0.62 }, { y: 0.8, f: 0, r: 0.5 }]
    },
    // ---- os chefes: `vidaFixa`, a barra no alto da tela e as frases
    lobo: {
        nome: "Lobo Alfa", vidaFixa: 45000, raio: 0.95, altura: 3.6, alcance: 1.4, vel: 3.3,
        preparo: 0.5, recupera: 0.6, dano: 0.9, pontos: 3000, surge: 2.5, grande: true, chefe: true,
        frases: ["O ALFA CHEGOU", "O ALFA ESTÁ FURIOSO", "LOBO ALFA DERROTADO"], cor: [0.35, 0.8, 1.6],
        cabeca: { y: 3.0, f: 0.5, r: 0.45 }, corpo: [{ y: 2.25, f: 0.15, r: 0.75 }, { y: 1.2, f: 0, r: 0.6 }]
    },
    gosma: {
        nome: "Matriarca Gosma", vidaFixa: 80000, raio: 1.25, altura: 3.4, alcance: 1.6, vel: 1.4,
        preparo: 0.8, recupera: 0.9, dano: 1.3, pontos: 4000, surge: 3.0, grande: true, chefe: true,
        frases: ["A MATRIARCA ACORDOU", "A MATRIARCA ESTÁ FURIOSA", "MATRIARCA GOSMA DERROTADA"], cor: [0.5, 1.6, 0.4],
        cabeca: { y: 3.1, f: 0.25, r: 0.5 }, corpo: [{ y: 2.0, f: 0.1, r: 1.05 }, { y: 0.9, f: 0, r: 0.85 }]
    },
    urso: {
        nome: "Urso Glacial", vidaFixa: 120000, raio: 1.25, altura: 4.0, alcance: 1.7, vel: 1.9,
        preparo: 0.7, recupera: 0.8, dano: 1.4, pontos: 5000, surge: 3.0, grande: true, chefe: true,
        frases: ["O URSO GLACIAL DESPERTOU", "O URSO ESTÁ FURIOSO", "URSO GLACIAL DERROTADO"], cor: [0.5, 1.1, 1.8],
        cabeca: { y: 3.55, f: 0.4, r: 0.55 }, corpo: [{ y: 2.5, f: 0.15, r: 1.0 }, { y: 1.3, f: 0, r: 0.85 }]
    },
    omega: {
        nome: "Sentinela Ômega", vidaFixa: 180000, raio: 1.1, altura: 4.4, alcance: 1.6, vel: 2.0,
        preparo: 0.7, recupera: 0.8, dano: 1.4, pontos: 6000, surge: 3.5, grande: true, chefe: true,
        frases: ["O SENTINELA DESPERTOU", "O SENTINELA ESTÁ FURIOSO", "SENTINELA ÔMEGA DERROTADO"], cor: [1.6, 0.5, 2.0],
        cabeca: { y: 3.95, f: 0.25, r: 0.5 },
        corpo: [{ y: 3.0, f: 0.1, r: 0.95 }, { y: 1.9, f: 0, r: 0.8 }, { y: 0.8, f: 0, r: 0.65 }]
    }
}
// quem cada chefe chama quando muda de fase (para a 2 e para a 3)
const INVOCA = {
    omega: [["corredor", 6], ["corredor", 9]],
    lobo: [["corredor", 4, "uivador", 1], ["corredor", 6, "uivador", 2]],
    gosma: [["cuspidor", 2, "bomba", 2], ["cuspidor", 3, "bomba", 3]],
    urso: [["corrompido", 5, "saltador", 2], ["corrompido", 7, "saltador", 3]]
}
// as ondas especiais: só um tipo, muitos, rápido
const ESPECIAIS = {
    corredores: { tipo: "corredor", n: (g) => Math.min(40, 8 + Math.round(g * 1.3)), intervalo: 0.55 },
    saltadores: { tipo: "saltador", n: (g) => Math.min(34, 6 + Math.round(g * 1.0)), intervalo: 0.7 }
}

function vidaBase(g) {
    return g <= 9 ? 100 + 70 * (g - 1) : 660 * Math.pow(1.085, g - 9)
}

function quantosNaOnda(g) {
    return Math.min(70, Math.round(6 + 2.6 * (g - 1) + 0.1 * (g - 1) * (g - 1)))
}

const MAX_VIVOS = 24

// ------------------------------------------------------------------ o mapa

const SOLIDO = { "#": Infinity, "C": Infinity, "N": Infinity, "X": 2.3, "=": 1.0, "M": 1.15,
                 "F": 2.2, "H": 2.4, "B": 2.4, "T": 2.4, "O": 2.4, "V": 2.4, "K": 2.4, "J": 2.4,
                 "Y": 1.25, "Q": 2.8 }
const PORTA_ALTA = Infinity

class Mapa {
    constructor(def) {
        const linhas = def.mapa
        this.def = def
        this.h = linhas.length
        this.w = Math.max(...linhas.map((l) => l.length))
        this.teto = def.teto
        const n = this.w * this.h
        this.solido = new Float32Array(n)
        this.porta = new Int8Array(n).fill(-1)
        this.area = new Int16Array(n).fill(-1)
        this.letra = new Array(n)
        this.portas = []
        this.objetos = []
        this.portais = []
        this.luzes = []
        this.inicio = { x: 1, z: 1 }
        const letraPorta = {}

        for (let z = 0; z < this.h; z++)
            for (let x = 0; x < this.w; x++) {
                const c = linhas[z][x] || "#"
                const i = z * this.w + x
                this.letra[i] = c
                if (c in SOLIDO) this.solido[i] = SOLIDO[c]
                else if (c >= "1" && c <= "9") this.solido[i] = Infinity
                else if (c >= "a" && c <= "f") {
                    if (!(c in letraPorta)) {
                        letraPorta[c] = this.portas.length
                        this.portas.push({ letra: c, custo: def.portas[c] || 1000, ladrilhos: [],
                                           aberta: false, abre: 0, areas: [] })
                    }
                    this.porta[i] = letraPorta[c]
                    this.portas[letraPorta[c]].ladrilhos.push(i)
                    this.solido[i] = PORTA_ALTA
                }
                if (c === "P") this.inicio = { x: x, z: z }
            }

        this._areas()
        // os robozinhos escondidos: [x, z] (ou [x, z, "pelucia"]) — podem estar em cima de algo
        for (const r of def.robozinhos || []) {
            const x = r[0], z = r[1], i = z * this.w + x
            const h = this.solido[i]
            this.objetos.push({ tipo: "robozinho", x: x, z: z, cx: (x + 0.5) * T, cz: (z + 0.5) * T, ux: (x + 0.5) * T, uz: (z + 0.5) * T,
                                base: isFinite(h) ? h : 0, alcance: h ? 2.1 : 1.4, achado: false, pelucia: r[2] === "pelucia", area: this.area[i] })
        }

        for (let z = 0; z < this.h; z++)
            for (let x = 0; x < this.w; x++) {
                const i = z * this.w + x, c = this.letra[i]
                const cx = (x + 0.5) * T, cz = (z + 0.5) * T
                if (c === "s") {
                    this.portais.push({ x: x, z: z, i: i, cx: cx, cz: cz, area: this.area[i], ocupado: 0 })
                    this.luzes.push({ x: cx, y: 0.5, z: cz, cor: def.portal, raio: 5, forca: 0.7 })
                } else if (c === "L") {
                    this.luzes.push({ x: cx, y: this.teto - 0.2, z: cz, cor: def.lampada, raio: 12, forca: 1 })
                } else if (c >= "1" && c <= "9") {
                    const d = this._frenteDaParede(x, z)
                    if (!d) continue
                    const arma = def.armasParede[c]
                    if (!arma) continue
                    const fx = cx + d[0] * T / 2, fz = cz + d[1] * T / 2
                    this.objetos.push({ tipo: "parede", arma: arma, x: x, z: z, cx: cx, cz: cz, dir: d,
                                        px: fx, pz: fz, ux: fx + d[0] * 0.55, uz: fz + d[1] * 0.55,
                                        alcance: 1.45, area: this.area[(z + d[1]) * this.w + x + d[0]] })
                    this.luzes.push({ x: fx + d[0] * 0.4, y: 1.7, z: fz + d[1] * 0.4, cor: [0.4, 0.9, 1.1], raio: 3.5, forca: 0.6 })
                } else if (c === "M" || c === "F" || c in MODULOS) {
                    const d = this._frenteDaMaquina(x, z)
                    const o = { tipo: c === "M" ? "caixa" : c === "F" ? "forja" : "modulo", letra: c, x: x, z: z,
                                cx: cx, cz: cz, dir: d, ux: cx, uz: cz, alcance: 2.15, area: this.area[i] }
                    if (o.tipo === "modulo") o.modulo = MODULOS[c]
                    this.objetos.push(o)
                    const cor = c === "M" ? [0.4, 0.95, 1.2] : c === "F" ? [1.3, 0.6, 0.2] : corDoModulo(c)
                    this.luzes.push({ x: cx + d[0] * 1.3, y: 1.6, z: cz + d[1] * 1.3, cor: cor, raio: 5, forca: 0.8 })
                } else if (c === "N" && this.letra[i - 1] !== "N" && this.letra[i - this.w] !== "N") {
                    // o núcleo ocupa 2 × 2: uma luz forte no meio dele
                    this.luzes.push({ x: cx + T / 2, y: 2.5, z: cz + T / 2, cor: [1.4, 0.3, 1.0], raio: 16, forca: 1.2 })
                    this.objetos.push({ tipo: "nucleo", x: x, z: z, cx: cx + T / 2, cz: cz + T / 2 })
                } else if (c in DECOR) {
                    this.objetos.push({ tipo: DECOR[c], x: x, z: z, cx: cx, cz: cz })
                }
            }
    }

    idx(x, z) { return z * this.w + x }
    dentro(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.h }

    /** A altura do sólido do ladrilho (0 = livre; fora do mapa é parede). */
    alt(x, z) {
        if (x < 0 || z < 0 || x >= this.w || z >= this.h) return Infinity
        return this.solido[z * this.w + x]
    }

    barreira(i) {
        const c = this.letra[i]
        return c === "#" || (c >= "1" && c <= "9") || this.porta[i] >= 0
    }

    _areas() {
        let n = 0
        for (let i = 0; i < this.w * this.h; i++) {
            if (this.barreira(i) || this.area[i] >= 0) continue
            const fila = [i]
            this.area[i] = n
            while (fila.length) {
                const k = fila.pop(), x = k % this.w, z = (k / this.w) | 0
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, nz = z + dz
                    if (!this.dentro(nx, nz)) continue
                    const j = nz * this.w + nx
                    if (this.area[j] < 0 && !this.barreira(j)) { this.area[j] = n; fila.push(j) }
                }
            }
            n++
        }
        this.nAreas = n
        for (const p of this.portas) {
            const s = new Set()
            for (const i of p.ladrilhos) {
                const x = i % this.w, z = (i / this.w) | 0
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = x + dx, nz = z + dz
                    if (this.dentro(nx, nz) && this.area[nz * this.w + nx] >= 0) s.add(this.area[nz * this.w + nx])
                }
            }
            p.areas = [...s]
        }
    }

    _frenteDaParede(x, z) {
        for (const d of [[0, 1], [0, -1], [1, 0], [-1, 0]])
            if (this.dentro(x + d[0], z + d[1]) && !this.barreira(this.idx(x + d[0], z + d[1])) &&
                this.solido[this.idx(x + d[0], z + d[1])] === 0)
                return d
        return null
    }

    /** Para onde a máquina olha: o lado livre com parede atrás, ou o mais aberto. */
    _frenteDaMaquina(x, z) {
        let melhor = [0, 1], nota = -1
        for (const d of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            if (this.alt(x + d[0], z + d[1]) !== 0) continue
            let v = 1
            if (this.alt(x - d[0], z - d[1]) === Infinity) v += 2
            for (let k = 2; k <= 3; k++) if (this.alt(x + d[0] * k, z + d[1] * k) === 0) v += 0.3
            if (v > nota) { nota = v; melhor = d }
        }
        return melhor
    }

    abrirPorta(p) {
        p.aberta = true
        for (const i of p.ladrilhos) this.solido[i] = 0
    }

    /** O círculo (x, z, r) encosta em algum sólido? */
    bate(x, z, r) {
        const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T)
        const z0 = Math.floor((z - r) / T), z1 = Math.floor((z + r) / T)
        for (let tz = z0; tz <= z1; tz++)
            for (let tx = x0; tx <= x1; tx++) {
                if (this.alt(tx, tz) === 0) continue
                const px = clamp(x, tx * T, tx * T + T), pz = clamp(z, tz * T, tz * T + T)
                if ((x - px) * (x - px) + (z - pz) * (z - pz) < r * r) return true
            }
        return false
    }

    /** Empurra o círculo para fora dos sólidos. Devolve se encostou. */
    resolver(p, r) {
        let bateu = false
        for (let volta = 0; volta < 3; volta++) {
            let mexeu = false
            const x0 = Math.floor((p.x - r) / T), x1 = Math.floor((p.x + r) / T)
            const z0 = Math.floor((p.z - r) / T), z1 = Math.floor((p.z + r) / T)
            for (let tz = z0; tz <= z1; tz++)
                for (let tx = x0; tx <= x1; tx++) {
                    if (this.alt(tx, tz) === 0) continue
                    const ax = tx * T, az = tz * T
                    const px = clamp(p.x, ax, ax + T), pz = clamp(p.z, az, az + T)
                    let dx = p.x - px, dz = p.z - pz
                    const d2 = dx * dx + dz * dz
                    if (d2 >= r * r) continue
                    if (d2 > 1e-10) {
                        const d = Math.sqrt(d2), k = (r - d) / d
                        p.x += dx * k
                        p.z += dz * k
                    } else {
                        // o centro entrou no ladrilho: sai pelo lado mais perto
                        const e = [p.x - ax, ax + T - p.x, p.z - az, az + T - p.z]
                        const m = Math.min(...e)
                        if (m === e[0]) p.x = ax - r
                        else if (m === e[1]) p.x = ax + T + r
                        else if (m === e[2]) p.z = az - r
                        else p.z = az + T + r
                    }
                    mexeu = bateu = true
                }
            if (!mexeu) break
        }
        return bateu
    }

    /** Dá para ir em linha reta de um ponto ao outro com o raio r? */
    livre(x0, z0, x1, z1, r) {
        const dx = x1 - x0, dz = z1 - z0
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.45))
        for (let i = 1; i <= n; i++)
            if (this.bate(x0 + dx * i / n, z0 + dz * i / n, r)) return false
        return true
    }

    /**
     * O raio (de tiro, de visão) contra paredes, objetos (pela altura de cada
     * um), chão e teto. Devolve a distância e a normal de onde bateu.
     */
    raio(ox, oy, oz, dx, dy, dz, max) {
        let tmax = max, n = null
        if (dy < -1e-9) { const t = -oy / dy; if (t < tmax) { tmax = t; n = [0, 1, 0] } }
        else if (dy > 1e-9) { const t = (this.teto - oy) / dy; if (t < tmax) { tmax = t; n = [0, -1, 0] } }
        let tx = Math.floor(ox / T), tz = Math.floor(oz / T)
        const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1
        const adx = Math.abs(dx), adz = Math.abs(dz)
        let tMaxX = adx > 1e-9 ? (dx > 0 ? (tx + 1) * T - ox : ox - tx * T) / adx : Infinity
        let tMaxZ = adz > 1e-9 ? (dz > 0 ? (tz + 1) * T - oz : oz - tz * T) / adz : Infinity
        const tdx = adx > 1e-9 ? T / adx : Infinity, tdz = adz > 1e-9 ? T / adz : Infinity
        let tEntra = 0, nEntra = null
        for (let passos = 0; passos < 400; passos++) {
            const a = this.alt(tx, tz)
            if (a > 0) {
                const tSai = Math.min(tMaxX, tMaxZ)
                const yE = oy + dy * tEntra, yS = oy + dy * tSai
                if (a === Infinity || Math.min(yE, yS) < a) {
                    let th = tEntra, nh = nEntra || [0, 1, 0]
                    if (a !== Infinity && yE >= a && dy < 0) { th = (a - oy) / dy; nh = [0, 1, 0] }
                    if (th < tmax) return { t: Math.max(0, th), n: nh }
                    break
                }
            }
            if (tMaxX < tMaxZ) {
                tEntra = tMaxX; tMaxX += tdx; tx += sx; nEntra = [-sx, 0, 0]
            } else {
                tEntra = tMaxZ; tMaxZ += tdz; tz += sz; nEntra = [0, 0, -sz]
            }
            if (tEntra > tmax) break
        }
        return { t: tmax, n: n }
    }

    visivel(ax, ay, az, bx, by, bz) {
        const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz)
        if (d < 1e-6) return true
        return this.raio(ax, ay, az, dx / d, dy / d, dz / d, d).t >= d - 0.05
    }
}

// os enfeites que são sólidos: caixotes, colunas, bancadas, vasos (Estufa) e cápsulas (Criogenia)
const DECOR = { X: "caixotes", C: "coluna", "=": "bancada", Y: "planta", Q: "capsula" }

function corDoModulo(c) {
    return { H: [1.3, 0.25, 0.25], B: [0.3, 1.2, 0.5], T: [1.2, 1.0, 0.2], O: [1.1, 0.3, 1.2], V: [0.3, 0.6, 1.4],
             K: [1.2, 0.6, 0.2], J: [0.9, 0.9, 1.2] }[c] || [1, 1, 1]
}

// ------------------------------------------------------------------ o campo de caminho
//
// Dijkstra do ladrilho da Protogen para todo o mapa (8 vizinhos, sem cortar
// quina). Cada monstro desce o campo; refeito quando ela troca de ladrilho
// ou uma porta abre.

class Campo {
    constructor(mapa) {
        this.mapa = mapa
        this.dist = new Float64Array(mapa.w * mapa.h)
        this.origem = -1
        this.versao = 0
    }

    calcular(ox, oz) {
        const m = this.mapa, w = m.w, d = this.dist
        d.fill(Infinity)
        const o = oz * w + ox
        this.origem = o
        this.versao++
        if (!m.dentro(ox, oz)) return
        const heap = [[0, o]]
        d[o] = 0
        const viz = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
                     [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]
        while (heap.length) {
            const [dc, i] = heapTira(heap)
            if (dc > d[i]) continue
            const x = i % w, z = (i / w) | 0
            for (const [dx, dz, c] of viz) {
                const nx = x + dx, nz = z + dz
                if (m.alt(nx, nz) !== 0) continue
                if (dx && dz && (m.alt(x + dx, z) !== 0 || m.alt(x, z + dz) !== 0)) continue
                const j = nz * w + nx, nd = dc + c
                if (nd < d[j]) { d[j] = nd; heapPoe(heap, [nd, j]) }
            }
        }
    }

    /** O vizinho que mais aproxima da Protogen (ou null). */
    proximo(x, z) {
        const m = this.mapa, w = m.w
        let melhor = null, md = this.dist[z * w + x]
        for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dz) continue
                const nx = x + dx, nz = z + dz
                if (m.alt(nx, nz) !== 0) continue
                if (dx && dz && (m.alt(x + dx, z) !== 0 || m.alt(x, z + dz) !== 0)) continue
                const v = this.dist[nz * w + nx]
                if (v < md) { md = v; melhor = [nx, nz] }
            }
        return melhor
    }

    em(x, z) {
        const tx = Math.floor(x / T), tz = Math.floor(z / T)
        if (!this.mapa.dentro(tx, tz)) return Infinity
        return this.dist[tz * this.mapa.w + tx]
    }
}

function heapPoe(h, v) {
    h.push(v)
    let i = h.length - 1
    while (i > 0) {
        const p = (i - 1) >> 1
        if (h[p][0] <= h[i][0]) break
        const t = h[p]; h[p] = h[i]; h[i] = t
        i = p
    }
}

function heapTira(h) {
    const topo = h[0], fim = h.pop()
    if (h.length) {
        h[0] = fim
        let i = 0
        for (;;) {
            const a = 2 * i + 1, b = a + 1
            let m = i
            if (a < h.length && h[a][0] < h[m][0]) m = a
            if (b < h.length && h[b][0] < h[m][0]) m = b
            if (m === i) break
            const t = h[m]; h[m] = h[i]; h[i] = t
            i = m
        }
    }
    return topo
}

// ------------------------------------------------------------------ o jogo

const PONTOS_INICIO = [500, 3500, 6000, 9000, 12000]
// o quanto os monstros batem mais forte a cada nível
const DANO_NIVEL = [1, 1.08, 1.16, 1.24, 1.32]
// começando direto num nível (pelo menu): o que a Protogen já traz
const KIT_INICIO = [
    [],
    [{ id: "enxame", nivel: 1 }],
    [{ id: "lanca", nivel: 1 }],
    [{ id: "lanca", nivel: 2 }],
    [{ id: "lanca", nivel: 2 }]
]

class Jogo {
    constructor(op) {
        op = op || {}
        this.rand = sorteio(op.semente !== undefined ? op.semente : (Math.random() * 4294967296) >>> 0)
        this.deus = !!op.deus
        this.eventos = []
        this.t = 0
        this.fase = "parado"
        this.infinito = false
    }

    ev(o) { this.eventos.push(o) }

    // -------------------------------------------------------------- começo

    novoJogo(nivel) {
        nivel = nivel || 0
        this.jog = {
            x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ex: 0, ez: 0, yaw: 0, pitch: 0, chao: true,
            olho: OLHO, vida: 100, vidaMax: 100, ultimoDano: -99, morto: false, reiniciando: 0,
            invul: 0, agachado: false, correndo: false, folego: 1, cansado: 0,
            armas: [{ id: "faisca", nivel: 1, pente: 10, reserva: 80 }], sel: 0,
            cad: 0, troca: 0, trocaPara: -1, recarga: 0, recargaTotal: 1, mira: 0, mirando: false,
            corpo: 0, corpoBateu: true, forjando: 0, forjaTipo: "nivel", recuo: 0, recuoVolta: 0, granadas: 2, lanca: 0,
            pontos: PONTOS_INICIO[nivel] || 500, modulos: { backup: 0 }, passo: 0, vel: 0,
            lento: 0, uivo: 0, pocaT: 0
        }
        for (const a of KIT_INICIO[nivel] || []) {
            const st = statsArma(a.id, a.nivel)
            this.jog.armas.push({ id: a.id, nivel: a.nivel, pente: st.pente, reserva: st.reserva })
        }
        if (nivel >= 1) this.jog.granadas = 3
        if (nivel >= 3) {
            const f = this.jog.armas[0]
            f.nivel = 2
            f.pente = statsArma("faisca", 2).pente
        }
        this.stats = { abates: 0, cabecas: 0, tiros: 0, acertos: 0, pontos: 0, ondas: 0, tempo: 0, niveis: 0 }
        this.infinito = false
        this.carregarNivel(nivel)
    }

    carregarNivel(i) {
        this.nivelIdx = i
        this.nivel = PZ.NIVEIS[i]
        this.mapa = new Mapa(this.nivel)
        this.campo = new Campo(this.mapa)
        this.monstros = []
        this.projeteis = []
        this.ondasDeChoque = []
        this.poderes = []
        this.pocas = []
        this.drone = null
        this.festa = 0
        this.ativos = {}
        for (const k in PODERES) if (PODERES[k].dura) this.ativos[k] = 0
        this.semPoder = 0
        this.poderesNaOnda = 0
        this.caixa = { estado: "parada", t: 0, arma: null }
        this.forjaT = 0
        this.chefe = null
        this.areaAberta = new Uint8Array(this.mapa.nAreas)
        let g0 = 0
        for (let k = 0; k < i; k++) g0 += PZ.NIVEIS[k].ondas
        this.g0 = g0
        const j = this.jog
        j.x = (this.mapa.inicio.x + 0.5) * T
        j.z = (this.mapa.inicio.z + 0.5) * T
        j.y = 0; j.vx = j.vy = j.vz = j.ex = j.ez = 0
        j.yaw = 0; j.pitch = 0
        j.vida = j.vidaMax
        j.morto = false; j.reiniciando = 0; j.invul = 0
        j.recarga = 0; j.troca = 0; j.forjando = 0; j.corpo = 0; j.lento = 0
        this.areaAberta[this.mapa.area[this.mapa.idx(this.mapa.inicio.x, this.mapa.inicio.z)]] = 1
        this.campo.calcular(this.mapa.inicio.x, this.mapa.inicio.z)
        this.onda = { n: 0, estado: "espera", timer: 7, fila: [], prox: 0, total: 0, especial: null, vivosMax: MAX_VIVOS }
        this.fase = "jogando"
        this.ev({ t: "nivel", nivel: this.nivel, i: i })
    }

    proximoNivel() {
        if (this.nivelIdx + 1 >= PZ.NIVEIS.length) return false
        this.stats.niveis++
        this.carregarNivel(this.nivelIdx + 1)
        return true
    }

    /** Depois da vitória: o Núcleo continua, onda atrás de onda, sem fim. */
    continuarInfinito() {
        this.infinito = true
        this.fase = "jogando"
        this.onda.estado = "espera"
        this.onda.timer = 8
    }

    g() { return this.g0 + this.onda.n }

    // -------------------------------------------------------------- utilidades

    olho() { const j = this.jog; return [j.x, j.y + j.olho, j.z] }

    frente() {
        const j = this.jog, cp = Math.cos(j.pitch)
        return [Math.sin(j.yaw) * cp, Math.sin(j.pitch), -Math.cos(j.yaw) * cp]
    }

    armaAtual() { return this.jog.armas[this.jog.sel] || null }

    statsAtual() {
        const s = this.armaAtual()
        return s ? statsArma(s.id, s.nivel) : null
    }

    precoCaixa() { return this.ativos.liquidacao > 0 ? 10 : PRECO_CAIXA }

    curar(n) {
        const j = this.jog
        if (j.morto || j.reiniciando > 0) return
        j.vida = Math.min(j.vidaMax, j.vida + n)
    }

    ganhar(n) {
        if (this.ativos.dobro > 0) n *= 2
        this.jog.pontos += n
        this.stats.pontos += n
        this.ev({ t: "pontos", n: n })
    }

    gastar(n) {
        if (this.jog.pontos < n) {
            this.ev({ t: "semPontos" })
            return false
        }
        this.jog.pontos -= n
        this.ev({ t: "compra", n: n })
        return true
    }

    // -------------------------------------------------------------- o passo

    /**
     * Um passo do jogo. `ent` é o que o jogador quer agora:
     *   frente, lado (−1..1), correr, agachar, mirar, atirar (segurando)
     *   pulsos (só no quadro em que apertou): pular, atirarPulso, recarregar,
     *   usar, corpo, granada, trocar, arma (0, 1 ou 2), uivo
     *   dYaw, dPitch (o mouse, em radianos)
     */
    passo(dt, ent) {
        ent = ent || {}
        if (this.fase !== "jogando" && this.fase !== "morrendo") return
        dt = Math.max(0, Math.min(dt, 0.05))
        this.t += dt
        this.stats.tempo += dt
        const j = this.jog

        for (const k in this.ativos)
            if (this.ativos[k] > 0) {
                this.ativos[k] = Math.max(0, this.ativos[k] - dt)
                if (this.ativos[k] === 0) this.ev({ t: "poderFim", id: k })
            }

        if (this.fase === "morrendo") {
            this.morteT -= dt
            if (this.morteT <= 0) {
                this.fase = "fim"
                this.ev({ t: "fim" })
            }
        } else if (j.reiniciando > 0) {
            j.reiniciando -= dt
            if (j.reiniciando <= 0) {
                j.vida = j.vidaMax
                j.invul = 3
                this.ev({ t: "reiniciou" })
            }
        } else {
            this.moverJogador(dt, ent)
            this.usarArmas(dt, ent)
            this.interagir(ent)
            if (ent.uivo) this.uivar()
        }
        if (j.invul > 0) j.invul -= dt
        if (j.lento > 0) j.lento = Math.max(0, j.lento - dt)

        this.atualizarCampo()
        this.ondas(dt)
        for (const e of this.monstros) this.monstro(e, dt)
        this.separar()
        this.monstros = this.monstros.filter((e) => !e.remover)
        this.moverProjeteis(dt)
        this.moverOndasDeChoque(dt)
        this.atualizarPocas(dt)
        this.atualizarDrone(dt)
        this.atualizarPoderes(dt)
        this.atualizarCaixa(dt)
        if (this.forjaT > 0) this.forjaT = Math.max(0, this.forjaT - dt)
        if (this.festa > 0) this.festa = Math.max(0, this.festa - dt)
        for (const p of this.mapa.portas) if (p.aberta && p.abre < 1) p.abre = Math.min(1, p.abre + dt * 1.4)
        for (const p of this.mapa.portais) if (p.ocupado > 0) p.ocupado -= dt

        // a vida volta sozinha, depois de um tempo sem apanhar
        if (!j.morto && j.reiniciando <= 0 && this.t - j.ultimoDano > 3.2 && j.vida < j.vidaMax)
            j.vida = Math.min(j.vidaMax, j.vida + j.vidaMax * 0.55 * dt)
    }

    // -------------------------------------------------------------- a Protogen

    moverJogador(dt, ent) {
        const j = this.jog
        j.yaw = (j.yaw + (ent.dYaw || 0)) % (Math.PI * 2)
        j.pitch = clamp(j.pitch + (ent.dPitch || 0), -1.45, 1.45)
        // o coice volta pela metade, devagar
        if (j.recuoVolta > 0) {
            const v = Math.min(j.recuoVolta, dt * 0.35)
            j.pitch = clamp(j.pitch - v, -1.45, 1.45)
            j.recuoVolta -= v
        }

        const fx = Math.sin(j.yaw), fz = -Math.cos(j.yaw)
        const rx = Math.cos(j.yaw), rz = Math.sin(j.yaw)
        const frente = clamp(ent.frente || 0, -1, 1), lado = clamp(ent.lado || 0, -1, 1)
        let mx = fx * frente + rx * lado, mz = fz * frente + rz * lado
        const ml = Math.hypot(mx, mz)
        if (ml > 1) { mx /= ml; mz /= ml }

        j.agachado = !!ent.agachar && j.chao
        const propulsor = !!j.modulos.propulsor
        const patas = this.ativos.patas > 0
        const querCorrer = !!ent.correr && frente > 0.3 && !j.agachado && !ent.atirar && !ent.mirar &&
                           j.forjando <= 0 && j.corpo <= 0
        if (querCorrer && j.folego > 0 && j.cansado <= 0) {
            j.correndo = true
            if (!patas) j.folego -= dt / (propulsor ? 9 : 4.5)
            if (j.folego <= 0) { j.folego = 0; j.cansado = 1.2 }
        } else {
            j.correndo = false
            if (j.cansado > 0) j.cansado -= dt
            else j.folego = Math.min(1, j.folego + dt / 3)
        }

        const st = this.statsAtual()
        let vel = 4.4 * (st ? st.peso : 1)
        if (j.correndo) vel *= propulsor ? 1.8 : 1.55
        if (j.agachado) vel *= 0.5
        if (patas) vel *= 1.3
        if (j.lento > 0) vel *= 0.55
        vel *= 1 - 0.4 * j.mira
        const k = j.chao ? 11 : 2.5
        j.vx += (mx * vel - j.vx) * Math.min(1, k * dt)
        j.vz += (mz * vel - j.vz) * Math.min(1, k * dt)

        if (ent.pular && j.chao && !j.agachado) {
            j.vy = 5.3
            j.chao = false
            this.ev({ t: "pulo" })
        }
        j.vy -= GRAVIDADE * dt
        j.y += j.vy * dt
        if (j.y <= 0) {
            if (!j.chao && j.vy < -4) this.ev({ t: "aterrissa" })
            j.y = 0; j.vy = 0; j.chao = true
        }
        if (j.y + 1.8 > this.mapa.teto) { j.y = this.mapa.teto - 1.8; j.vy = Math.min(0, j.vy) }

        // o empurrão (investida do Brutamonte, onda de choque) se desfaz
        j.ex *= Math.max(0, 1 - dt * 5)
        j.ez *= Math.max(0, 1 - dt * 5)

        const p = { x: j.x + (j.vx + j.ex) * dt, z: j.z + (j.vz + j.ez) * dt }
        this.mapa.resolver(p, RAIO_JOG)
        // os monstros são corpos: param a Protogen (e encurralam)
        for (const e of this.monstros) {
            if (e.morto || e.y < -0.6) continue
            const r = e.def.raio + RAIO_JOG
            const dx = p.x - e.x, dz = p.z - e.z, d2 = dx * dx + dz * dz
            if (d2 < r * r && d2 > 1e-8) {
                const d = Math.sqrt(d2)
                p.x = e.x + dx / d * r
                p.z = e.z + dz / d * r
            }
        }
        this.mapa.resolver(p, RAIO_JOG)
        if (!this.mapa.bate(p.x, p.z, RAIO_JOG - 0.02)) { j.x = p.x; j.z = p.z }
        else {
            // sem saída limpa (prensada num canto): fica onde estava
            j.vx = j.vz = 0
        }

        const alvo = j.agachado ? OLHO_AGACHADO : OLHO
        j.olho += (alvo - j.olho) * Math.min(1, dt * 12)
        j.vel = j.chao ? Math.hypot(j.vx, j.vz) : 0
        const passoAntes = j.passo
        j.passo += j.vel * dt
        if (j.chao && Math.floor(j.passo / 2.1) !== Math.floor(passoAntes / 2.1)) this.ev({ t: "passo", correndo: j.correndo })
    }

    tile() {
        const j = this.jog
        return [clamp(Math.floor(j.x / T), 0, this.mapa.w - 1), clamp(Math.floor(j.z / T), 0, this.mapa.h - 1)]
    }

    atualizarCampo() {
        const [tx, tz] = this.tile()
        const i = this.mapa.idx(tx, tz)
        if (i !== this.campo.origem || this.campoSujo) {
            this.campoSujo = false
            this.campo.calcular(tx, tz)
        }
    }

    /** Dano na Protogen. Devolve se pegou (o escudo e a invulnerabilidade seguram). */
    ferirJogador(dano, de, empurra) {
        const j = this.jog
        if (j.morto || j.reiniciando > 0 || j.invul > 0 || this.fase !== "jogando") return false
        if (this.ativos.escudo > 0) { this.ev({ t: "bloqueio", de: de }); return false }
        if (empurra) { j.ex += empurra[0]; j.ez += empurra[1] }
        this.ev({ t: "dano", n: dano, de: de })
        j.ultimoDano = this.t
        if (this.deus) return true
        j.vida -= dano
        if (j.vida > 0) return true
        j.vida = 0
        if (j.modulos.backup > 0) {
            j.modulos.backup--
            j.reiniciando = 2.6
            j.recarga = 0; j.corpo = 0
            this.ev({ t: "reiniciando" })
            // o pulso da volta: afasta e queima quem estiver perto
            for (const e of this.monstros) {
                if (e.morto) continue
                const dx = e.x - j.x, dz = e.z - j.z, d = Math.hypot(dx, dz)
                if (d < 7) {
                    if (!e.def.grande) this.ferir(e, 1e9, { tipo: "emp", semPontos: true })
                    else { e.ex += dx / (d || 1) * 8; e.ez += dz / (d || 1) * 8 }
                }
            }
            this.ev({ t: "explosao", p: [j.x, 1, j.z], raio: 7, emp: true })
            return
        }
        j.morto = true
        this.fase = "morrendo"
        this.morteT = 2.8
        this.stats.ondas = Math.max(0, this.onda.n - 1)
        this.ev({ t: "morte" })
    }

    // -------------------------------------------------------------- armas

    usarArmas(dt, ent) {
        const j = this.jog
        j.cad -= dt
        if (j.lanca > 0) j.lanca -= dt
        const s = this.armaAtual()

        if (j.forjando > 0) {
            j.forjando -= dt
            j.mira = Math.max(0, j.mira - dt * 8)
            if (j.forjando <= 0) {
                if (j.forjaTipo === "elemento") {
                    // troca por um elemento diferente do que tinha
                    const outros = Object.keys(ELEMENTOS).filter((k) => k !== s.elem)
                    s.elem = outros[Math.floor(this.rand() * outros.length)]
                } else {
                    s.nivel = Math.min(MAX_NIVEL, s.nivel + 1)
                    if (s.nivel >= 3 && !s.elem) {
                        const ks = Object.keys(ELEMENTOS)
                        s.elem = ks[Math.floor(this.rand() * ks.length)]
                    }
                }
                const st = statsArma(s.id, s.nivel)
                s.pente = st.pente
                s.reserva = st.reserva
                this.ev({ t: "forjada", arma: s.id, nivel: s.nivel, nome: st.nome, elem: s.elem || null,
                          soElemento: j.forjaTipo === "elemento" })
            }
            return
        }

        // troca de arma: meio tempo abaixando, meio levantando
        if (j.troca > 0) {
            const antes = j.troca
            j.troca -= dt
            if (antes > 0.25 && j.troca <= 0.25 && j.trocaPara >= 0) {
                j.sel = j.trocaPara
                j.trocaPara = -1
            }
        }
        let quer = -1
        if (ent.trocar && j.armas.length > 1) quer = (j.sel + 1) % j.armas.length
        if (ent.arma !== undefined && ent.arma !== null && ent.arma < j.armas.length && ent.arma !== j.sel) quer = ent.arma
        if (quer >= 0 && j.troca <= 0 && j.corpo <= 0) {
            j.troca = 0.5
            j.trocaPara = quer
            j.recarga = 0
            this.ev({ t: "troca" })
        }

        // golpe de garra
        if (j.corpo > 0) {
            j.corpo -= dt
            if (!j.corpoBateu && j.corpo <= 0.4) { j.corpoBateu = true; this.golpe() }
        }
        if (ent.corpo && j.corpo <= 0 && j.troca <= 0) {
            j.corpo = 0.55
            j.corpoBateu = false
            j.recarga = 0
            this.ev({ t: "garra" })
        }

        if (ent.granada && j.granadas > 0 && j.corpo <= 0 && j.lanca <= 0) {
            j.granadas--
            j.lanca = 0.6
            const o = this.olho(), f = this.frente()
            this.projeteis.push({ tipo: "granada", x: o[0] + f[0] * 0.5, y: o[1] - 0.15, z: o[2] + f[2] * 0.5,
                                  vx: f[0] * 14 + j.vx * 0.5, vy: f[1] * 14 + 3.2, vz: f[2] * 14 + j.vz * 0.5,
                                  vida: 1.7, girar: this.rand() * 6 })
            this.ev({ t: "granada" })
        }

        if (!s) return
        const st = statsArma(s.id, s.nivel)
        const pode = j.troca <= 0 && j.corpo <= 0
        j.mirando = !!ent.mirar && pode && !j.correndo
        j.mira = clamp(j.mira + (j.mirando ? dt * 7 : -dt * 7), 0, 1)

        if (j.recarga > 0) {
            j.recarga -= dt
            if (j.recarga <= 0) {
                j.recarga = 0
                const n = st.infinita ? st.pente - s.pente : Math.min(st.pente - s.pente, s.reserva)
                s.pente += n
                if (!st.infinita) s.reserva -= n
                this.ev({ t: "recarregou" })
            }
        }
        const comecaRecarga = () => {
            if (j.recarga > 0 || s.pente >= st.pente || (s.reserva <= 0 && !st.infinita)) return
            j.recargaTotal = st.recarga * (j.modulos.turbo ? 0.5 : 1)
            j.recarga = j.recargaTotal
            this.ev({ t: "recarga", arma: s.id })
        }
        if (ent.recarregar && pode) comecaRecarga()

        const gatilho = st.modo === "auto" ? !!ent.atirar : !!ent.atirarPulso
        if (gatilho && pode && j.cad <= 0 && j.recarga <= 0 && !j.correndo) {
            if (s.pente > 0) this.atirar(s, st)
            else if (s.reserva > 0 || st.infinita) comecaRecarga()
            else { this.ev({ t: "vazio" }); j.cad = 0.3 }
        }
        if (s.pente === 0 && (s.reserva > 0 || st.infinita) && j.cad <= 0 && pode) comecaRecarga()
    }

    atirar(s, st) {
        const j = this.jog
        const furia = this.ativos.furia > 0
        if (!furia) s.pente--
        j.cad = st.cad * (j.modulos.overclock ? 0.75 : 1) * (furia ? 0.5 : 1)
        this.stats.tiros++
        const o = this.olho(), f = this.frente()
        const mov = clamp(j.vel / 4.4, 0, 1.5)
        let disp = (st.disp + (st.dispMira - st.disp) * j.mira) * (1 + 0.7 * mov * (1 - j.mira))
        if (j.agachado) disp *= 0.7
        if (!j.chao) disp *= 1.8
        if (st.balas > 1) disp = st.disp * (1 - 0.3 * j.mira)

        const coice = st.recuo * (1 - 0.45 * j.mira) * (j.agachado ? 0.7 : 1)
        j.pitch = clamp(j.pitch + coice, -1.45, 1.45)
        j.recuoVolta += coice * 0.55
        j.yaw += (this.rand() - 0.5) * coice * 0.6
        j.recuo = 1
        this.ev({ t: "tiro", arma: s.id, nivel: s.nivel })

        if (st.boop) {
            const d = this.espalhar(f, disp)
            this.projeteis.push({ tipo: "coracao", x: o[0] + d[0] * 0.5, y: o[1] - 0.1, z: o[2] + d[2] * 0.5,
                                  vx: d[0] * st.boop, vy: d[1] * st.boop, vz: d[2] * st.boop, vida: 2.5,
                                  dano: st.dano, fura: 5 + 2 * s.nivel, atingidos: new Set(), girar: 0 })
            return
        }
        if (st.projetil) {
            const d = this.espalhar(f, disp)
            this.projeteis.push({ tipo: "foguete", x: o[0] + d[0] * 0.6, y: o[1] - 0.12, z: o[2] + d[2] * 0.6,
                                  vx: d[0] * st.projetil, vy: d[1] * st.projetil, vz: d[2] * st.projetil,
                                  vida: 3, dano: st.dano, raio: st.raio, nivel: s.nivel })
            return
        }
        if (st.corrente) return this.raioTesla(o, f, st)
        if (st.chamas) return this.lancaChamas(o, f, st, s)

        const acertou = new Set()
        for (let b = 0; b < st.balas; b++) {
            const d = this.espalhar(f, disp)
            const parede = this.mapa.raio(o[0], o[1], o[2], d[0], d[1], d[2], 90)
            const hits = []
            for (const e of this.monstros) {
                if (e.morto) continue
                const h = this.raioMonstro(e, o, d, parede.t)
                if (h) hits.push(h)
            }
            hits.sort((a, b2) => a.t - b2.t)
            let fim = parede.t, bateuParede = true
            for (const h of hits) {
                const dano = st.dano * (h.cabeca ? st.cabeca : 1)
                const primeiro = !acertou.has(h.e)
                acertou.add(h.e)
                this.ev({ t: "impacto", p: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t],
                          n: [-d[0], -d[1], -d[2]], monstro: true, cabeca: h.cabeca })
                this.ferir(h.e, dano, { cabeca: h.cabeca, tipo: "bala", pontosAcerto: primeiro, dir: d })
                if (st.frio) this.esfriar(h.e, st.frio * (1 + 0.15 * (s.nivel - 1)))
                if (s.elem) this.elemento(s, h.e, st)
                if (!st.perfura) { fim = h.t; bateuParede = false; break }
            }
            if (bateuParede && parede.n)
                this.ev({ t: "impacto", p: [o[0] + d[0] * fim, o[1] + d[1] * fim, o[2] + d[2] * fim], n: parede.n })
            this.ev({ t: "traco", ate: [o[0] + d[0] * fim, o[1] + d[1] * fim, o[2] + d[2] * fim], arma: s.id, nivel: s.nivel })
        }
        if (acertou.size) this.stats.acertos++
    }

    espalhar(f, disp) {
        if (disp <= 0) return f.slice()
        const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * disp
        // dois vetores perpendiculares à frente
        let ux = 0, uy = 1, uz = 0
        if (Math.abs(f[1]) > 0.95) { ux = 1; uy = 0 }
        let sx = f[1] * uz - f[2] * uy, sy = f[2] * ux - f[0] * uz, sz = f[0] * uy - f[1] * ux
        const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl
        const vx = sy * f[2] - sz * f[1], vy = sz * f[0] - sx * f[2], vz = sx * f[1] - sy * f[0]
        const c = Math.cos(a) * r, s = Math.sin(a) * r
        const d = [f[0] + sx * c + vx * s, f[1] + sy * c + vy * s, f[2] + sz * c + vz * s]
        const l = Math.hypot(d[0], d[1], d[2])
        return [d[0] / l, d[1] / l, d[2] / l]
    }

    /** A Fornalha: um cone curto de fogo que pega em todo mundo na frente. */
    lancaChamas(o, f, st, s) {
        const alcance = st.chamas
        const parede = this.mapa.raio(o[0], o[1], o[2], f[0], f[1], f[2], alcance)
        let n = 0
        for (const e of this.monstros) {
            if (e.morto || e.y < -0.8) continue
            const cy = e.y + e.def.altura * 0.55
            const dx = e.x - o[0], dy = cy - o[1], dz = e.z - o[2]
            const d = Math.hypot(dx, dy, dz)
            if (d > alcance + e.def.raio) continue
            // ao longo da mira, e a distância até o eixo do cone (que abre com a distância)
            const ao = dx * f[0] + dy * f[1] + dz * f[2]
            if (ao < 0 || ao > parede.t + e.def.raio) continue
            const perp = Math.sqrt(Math.max(0, d * d - ao * ao))
            if (perp > 0.35 + ao * 0.2 + e.def.raio) continue
            if (!this.mapa.visivel(o[0], o[1], o[2], e.x, cy, e.z)) continue
            this.ferir(e, st.dano, { tipo: "fogo", silencioso: true })
            this.incendiar(e, 3, st.dano * 4)
            if (s.elem && s.elem !== "fogo") this.elemento(s, e, st)
            n++
        }
        if (n) {
            this.stats.acertos++
            // um tique de acerto de vez em quando (a cada chama seria uma metralhadora de som)
            if (this.t - (this.ultimoChiado || -9) > 0.2) { this.ultimoChiado = this.t; this.ev({ t: "acerto", cabeca: false, morte: false }) }
        }
        this.ev({ t: "chamas", ate: Math.min(parede.t, alcance) })
    }

    /** Fogo no monstro: `dps` de dano por `dura` segundos. */
    incendiar(e, dura, dps) {
        if (e.morto) return
        if (!(e.queima > 0)) e.queimaDps = 0
        e.queima = Math.max(e.queima || 0, dura)
        e.queimaDps = Math.max(e.queimaDps, dps)
    }

    /** O frio da Nevasca: deixa lento e, acumulado, congela (os grandes só ficam lentos). */
    esfriar(e, k) {
        if (e.morto) return
        e.lento = Math.max(e.lento || 0, 2)
        if (e.def.grande) return
        e.frio = (e.frio || 0) + k
        if (e.frio >= 1) { e.frio = 0; this.congelarMonstro(e, 2.5) }
    }

    congelarMonstro(e, s) {
        if (e.morto) return
        if (e.def.grande || e.estado === "saltando" || e.estado === "surgindo") { e.lento = Math.max(e.lento || 0, s); return }
        if (!(e.congelado > 0)) this.ev({ t: "congelou", p: [e.x, e.y + 1, e.z] })
        e.congelado = Math.max(e.congelado || 0, s)
    }

    /** Tonto por `s` segundos (o chefe não fica, nem quem está no ar). */
    atordoar(e, s) {
        if (e.morto || e.def.chefe || e.estado === "saltando" || e.estado === "surgindo") return
        e.estado = "atordoado"
        e.tm = 0
        e.atordoadoDura = s
    }

    /**
     * O elemento da arma (Mk III e IV): às vezes, no acerto, o fogo pega, o
     * gelo congela ou o choque pula para os vizinhos.
     */
    elemento(s, e, st) {
        if (e.morto && s.elem !== "choque") return
        const chance = s.nivel >= 4 ? 0.22 : 0.13
        if (this.t < (e.elemCD || 0) || this.rand() > chance) return
        e.elemCD = this.t + 1.2
        const p = [e.x, e.y + e.def.altura * 0.6, e.z]
        const forte = s.nivel >= 4
        if (s.elem === "fogo") this.incendiar(e, 4, vidaBase(this.g()) * (forte ? 0.5 : 0.35))
        else if (s.elem === "gelo") this.congelarMonstro(e, forte ? 3 : 2)
        else if (s.elem === "choque") {
            const pontos = [p], atingidos = new Set([e])
            let atual = e
            for (let k = 0; k < (forte ? 4 : 3); k++) {
                let prox = null, md = 6
                for (const o of this.monstros) {
                    if (o.morto || atingidos.has(o) || o.y < -1) continue
                    const d = Math.hypot(o.x - atual.x, o.z - atual.z)
                    if (d < md && this.mapa.visivel(atual.x, 1.2, atual.z, o.x, 1.2, o.z)) { md = d; prox = o }
                }
                if (!prox) break
                atingidos.add(prox)
                pontos.push([prox.x, prox.y + prox.def.altura * 0.6, prox.z])
                this.ferir(prox, Math.max(st.dano * 2, vidaBase(this.g()) * 0.4), { tipo: "tesla", silencioso: true })
                atual = prox
            }
            if (pontos.length > 1) this.ev({ t: "choque", pontos: pontos })
        }
        this.ev({ t: "elemento", elem: s.elem, p: p })
    }

    /** O Uivo da Protogen (Z, com a barra cheia): atordoa e empurra quem está perto, e dá fúria. */
    uivar() {
        const j = this.jog
        if (j.uivo < 1 || j.morto || j.reiniciando > 0) return
        j.uivo = 0
        let n = 0
        for (const e of this.monstros) {
            if (e.morto || e.y < -1) continue
            const dx = e.x - j.x, dz = e.z - j.z, d = Math.hypot(dx, dz)
            if (d > 12 || !this.mapa.visivel(j.x, 1.2, j.z, e.x, 1.2, e.z)) continue
            if (e.def.chefe) { this.ferir(e, e.vidaMax * 0.03, { tipo: "uivo", silencioso: true }); continue }
            this.atordoar(e, 2.5)
            if (!e.def.grande) { e.ex += dx / (d || 1) * 7; e.ez += dz / (d || 1) * 7 }
            n++
        }
        this.ativos.furia = Math.max(this.ativos.furia, 6)
        this.ev({ t: "uivoJog", n: n, p: [j.x, 1.2, j.z] })
    }

    /** As esferas de acerto do monstro, no mundo. */
    esferas(e) {
        const fx = Math.sin(e.ang), fz = -Math.cos(e.ang)
        const out = []
        const k = e.def.escala || 1, q = e.esc || 1
        const c = e.def.cabeca
        // cabeçudo: a cabeça cresce em volta do pescoço (o centro sobe, o raio cresce)
        const kc = PZ.segredos.cabecudo ? CABECUDO : 1, sobe = c.r * 0.85 * (kc - 1)
        if (!e.semCabeca) out.push({ x: e.x + fx * c.f * q * kc, y: e.y + (c.y + sobe) * q, z: e.z + fz * c.f * q * kc, r: (c.r * kc + 0.04) * q, cabeca: true })
        for (const b of e.def.corpo)
            out.push({ x: e.x + fx * b.f * k * q, y: e.y + b.y * q, z: e.z + fz * b.f * k * q, r: (b.r + 0.04) * q, cabeca: false })
        return out
    }

    raioMonstro(e, o, d, max) {
        let melhor = null
        for (const s of this.esferas(e)) {
            const ox = o[0] - s.x, oy = o[1] - s.y, oz = o[2] - s.z
            const b = ox * d[0] + oy * d[1] + oz * d[2]
            const c = ox * ox + oy * oy + oz * oz - s.r * s.r
            const disc = b * b - c
            if (disc < 0) continue
            const sq = Math.sqrt(disc)
            let t = -b - sq
            if (t < 0) t = -b + sq
            if (t < 0 || t > max) continue
            if (!melhor || t < melhor.t || (Math.abs(t - melhor.t) < 0.05 && s.cabeca))
                melhor = { t: t, cabeca: s.cabeca, e: e }
        }
        return melhor
    }

    raioTesla(o, f, st) {
        const parede = this.mapa.raio(o[0], o[1], o[2], f[0], f[1], f[2], 40)
        let primeiro = null
        for (const e of this.monstros) {
            if (e.morto) continue
            const h = this.raioMonstro(e, o, f, parede.t)
            if (h && (!primeiro || h.t < primeiro.t)) primeiro = h
        }
        // sem acertar em cheio, o raio pula para o mais perto da mira (cone de 8°)
        if (!primeiro) {
            let md = Infinity
            for (const e of this.monstros) {
                if (e.morto || e.y < -1) continue
                const dx = e.x - o[0], dy = e.y + 1.1 - o[1], dz = e.z - o[2]
                const d = Math.hypot(dx, dy, dz)
                if (d > 22 || d < 0.3) continue
                const cos = (dx * f[0] + dy * f[1] + dz * f[2]) / d
                if (cos < 0.99 || !this.mapa.visivel(o[0], o[1], o[2], e.x, e.y + 1.1, e.z)) continue
                if (d < md) { md = d; primeiro = { e: e, t: d, cabeca: false } }
            }
        }
        const pontos = []
        if (!primeiro) {
            const t = Math.min(parede.t, 18)
            pontos.push([o[0] + f[0] * t, o[1] + f[1] * t, o[2] + f[2] * t])
            this.ev({ t: "tesla", pontos: pontos })
            return
        }
        const atingidos = new Set()
        let atual = primeiro.e
        for (let k = 0; k < st.corrente && atual; k++) {
            atingidos.add(atual)
            pontos.push([atual.x, atual.y + atual.def.altura * 0.6, atual.z])
            this.ferir(atual, st.dano * Math.pow(0.85, k), { tipo: "tesla", pontosAcerto: true })
            let prox = null, md = 7.5
            for (const e of this.monstros) {
                if (e.morto && !atingidos.has(e) || atingidos.has(e) || e.y < -1) continue
                if (e.morto) continue
                const d = Math.hypot(e.x - atual.x, e.z - atual.z)
                if (d < md && this.mapa.visivel(atual.x, 1.2, atual.z, e.x, 1.2, e.z)) { md = d; prox = e }
            }
            atual = prox
        }
        this.ev({ t: "tesla", pontos: pontos })
    }

    /** O boop do Booper: o comum cai (em corações); o grande leva o dano e fica tonto. */
    boop(e, dano) {
        this.ev({ t: "boop", p: [e.x, e.y + e.def.altura * 0.8, e.z], booper: true })
        if (!e.def.grande) this.ferir(e, e.vida + 1, { tipo: "boop", pontosAcerto: true })
        else {
            this.ferir(e, dano, { tipo: "boop", pontosAcerto: true })
            if (!e.morto) this.atordoar(e, 1.2)
        }
    }

    golpe() {
        const j = this.jog, o = this.olho(), f = this.frente()
        const presas = !!j.modulos.presas
        let alvo = null, md = presas ? 2.8 : 2.3
        for (const e of this.monstros) {
            if (e.morto || e.y < -0.8) continue
            const dx = e.x - j.x, dz = e.z - j.z, d = Math.hypot(dx, dz) - e.def.raio
            if (d > md) continue
            const fl = Math.hypot(f[0], f[2]) || 1
            const cos = (dx * f[0] + dz * f[2]) / ((Math.hypot(dx, dz) || 1) * fl)
            if (cos < 0.45) continue
            if (!this.mapa.visivel(o[0], o[1] - 0.3, o[2], e.x, e.y + 1, e.z)) continue
            md = d
            alvo = e
        }
        this.ev({ t: "golpe", acertou: !!alvo })
        // garra num protogen corrompido não é golpe: é boop (fica tonto, de olho de coração)
        if (alvo && alvo.tipo === "corrompido" && MONSTROS.corrompido.protogens.includes(alvo.variante)) {
            this.stats.boops = (this.stats.boops || 0) + 1
            alvo.coracao = 2.5
            this.atordoar(alvo, 2.5)
            this.ganhar(50)
            this.ev({ t: "boop", p: [alvo.x, alvo.y + alvo.def.altura * 0.9, alvo.z], garra: true, n: this.stats.boops })
        }
        if (!alvo) return
        const dx = alvo.x - j.x, dz = alvo.z - j.z, d = Math.hypot(dx, dz) || 1
        if (!alvo.def.grande) { alvo.ex += dx / d * 4; alvo.ez += dz / d * 4 }
        this.ev({ t: "impacto", p: [alvo.x, alvo.y + 1.2, alvo.z], n: [-dx / d, 0, -dz / d], monstro: true })
        // a garra acompanha as ondas (senão, lá na frente, ela vira cócega)
        const dano = Math.max(150, vidaBase(this.g()) * 0.45) * (presas ? 4 : 1)
        this.ferir(alvo, dano, { tipo: "garra", pontosAcerto: true })
    }

    /**
     * Dano no monstro. `op`: cabeca, tipo, pontosAcerto, semPontos, dir,
     * silencioso (sem o tique de acerto — fogo, choque em cadeia).
     */
    ferir(e, dano, op) {
        if (e.morto) return
        op = op || {}
        if (this.ativos.critico > 0 && !e.def.grande) dano = e.vida + 1
        if (e.estado === "atordoado" || e.congelado > 0) dano *= 1.5
        e.vida -= dano
        if (!op.silencioso) e.flash = 1
        e.atingido = Math.min(1, e.atingido + Math.min(1, dano / (e.vidaMax * 0.25)))
        if (!op.silencioso || e.vida <= 0) this.ev({ t: "acerto", cabeca: !!op.cabeca, morte: e.vida <= 0, chefe: !!e.def.chefe })
        if (this.ativos.vampiro > 0 && !op.semPontos) this.curar(op.silencioso ? 0.3 : 2)
        if (e.vida <= 0) {
            this.matar(e, op)
        } else {
            if (op.pontosAcerto && !op.semPontos) this.ganhar(10)
            if (e.def.chefe) this.faseDoChefe(e)
        }
    }

    matar(e, op) {
        e.vida = 0
        e.morto = true
        e.estado = "morrendo"
        e.tm = 0
        e.queda = (op.dir && (op.dir[0] * Math.sin(e.ang) - op.dir[2] * Math.cos(e.ang)) > 0) ? -1 : 1
        if (op.cabeca && !e.def.grande) e.semCabeca = true
        this.stats.abates++
        if (op.cabeca) this.stats.cabecas++
        const j = this.jog
        if (!op.semPontos) {
            let p = e.def.pontos
            if (!e.def.grande) {
                if (op.tipo === "garra") p = Math.max(p, 130)
                else if (op.cabeca) p = Math.max(p, 100)
            }
            if (e.portador) p += 100
            this.ganhar(p)
            // a barra do Uivo enche com os abates
            j.uivo = Math.min(1, j.uivo + (e.def.chefe ? 1 : e.def.grande ? 0.2 : op.cabeca ? 0.06 : 0.04))
            if (this.ativos.vampiro > 0) this.curar(10)
        }
        const congelado = e.congelado > 0
        e.congelado = 0
        this.ev({ t: "morreu", e: e, cabeca: !!op.cabeca, tipo: e.tipo, congelado: congelado, queimando: e.queima > 0, jeito: op.tipo })
        // quem morre pegando fogo passa o fogo para quem está colado
        if (e.queima > 0) {
            for (const o of this.monstros)
                if (!o.morto && o !== e && Math.hypot(o.x - e.x, o.z - e.z) < 2.5) this.incendiar(o, 2.5, e.queimaDps * 0.6)
            e.queima = 0
        }
        if (e.tipo === "bomba" && !e.explodiu) {
            e.explodiu = true
            this.explosao(e.x, 0.8, e.z, 3.6, 900, { bomba: true })
        }
        if (e.def.chefe) {
            this.chefe = null
            this.ev({ t: "chefeMorreu", nome: e.def.nome, frase: e.def.frases[2], tipo: e.tipo })
            // o chefe deixa dois poderes
            for (const k of [-1, 1]) {
                const x = e.x + k * 1.2, z = e.z
                const ok = this.mapa.alt(Math.floor(x / T), Math.floor(z / T)) === 0
                this.soltarPoder(this.sortearPoder(), ok ? x : e.x, z)
            }
        } else if (op.tipo !== "emp") this.talvezPoder(e)
        this.ultimaMorte = [e.x, e.z]
    }

    explosao(x, y, z, raio, dano, op) {
        op = op || {}
        this.ev({ t: "explosao", p: [x, y, z], raio: raio, bomba: !!op.bomba })
        for (const e of this.monstros) {
            if (e.morto) continue
            const d = Math.hypot(e.x - x, e.y + e.def.altura * 0.5 - y, e.z - z)
            if (d > raio + e.def.raio) continue
            if (!this.mapa.visivel(x, y + 0.1, z, e.x, e.y + e.def.altura * 0.5, e.z)) continue
            const k = clamp(1 - d / (raio + e.def.raio), 0, 1) * 0.6 + 0.4
            const dx = e.x - x, dz = e.z - z, dl = Math.hypot(dx, dz) || 1
            if (!e.def.grande) { e.ex += dx / dl * 5 * k; e.ez += dz / dl * 5 * k }
            this.ferir(e, dano * k, { tipo: "explosao", pontosAcerto: !op.bomba, semPontos: !!op.bomba })
        }
        if (op.bomba) {
            const j = this.jog, d = Math.hypot(j.x - x, j.y + 1 - y, j.z - z)
            if (d < raio && this.mapa.visivel(x, y + 0.1, z, j.x, j.y + 1, j.z)) {
                const dl = Math.hypot(j.x - x, j.z - z) || 1
                this.ferirJogador(Math.round(20 + 40 * (1 - d / raio)), [x, z],
                                  [(j.x - x) / dl * 6, (j.z - z) / dl * 6])
            }
        }
    }

    // -------------------------------------------------------------- comprar e usar

    interagir(ent) {
        const u = this.avaliarUso()
        this.uso = u
        if (!ent.usar || !u || !u.acao) return
        u.acao()
    }

    /** O que está ao alcance agora: o texto da dica e o que acontece no E. */
    avaliarUso() {
        const j = this.jog, m = this.mapa
        let melhor = null, md = Infinity
        const fx = Math.sin(j.yaw), fz = -Math.cos(j.yaw)
        const considera = (d, item) => { if (d < md) { md = d; melhor = item } }

        for (const p of m.portas) {
            if (p.aberta) continue
            for (const i of p.ladrilhos) {
                const cx = (i % m.w + 0.5) * T, cz = (((i / m.w) | 0) + 0.5) * T
                const d = Math.hypot(j.x - cx, j.z - cz)
                if (d < 2.25) considera(d, { tipo: "porta", porta: p })
            }
        }
        for (const o of m.objetos) {
            if (!o.alcance) continue
            const d = Math.hypot(j.x - o.ux, j.z - o.uz)
            if (d > o.alcance) continue
            // de longe, só o que está mais ou menos na frente
            if (d > 1.0 && ((o.ux - j.x) * fx + (o.uz - j.z) * fz) / d < 0.1) continue
            considera(d, { tipo: o.tipo, obj: o })
        }
        if (!melhor) return null
        return this.descrever(melhor)
    }

    descrever(u) {
        const j = this.jog, s = this.armaAtual()
        const pts = j.pontos
        if (u.tipo === "porta") {
            const p = u.porta
            u.texto = "Abrir porta"
            u.custo = p.custo
            u.acao = () => { if (this.gastar(p.custo)) this.abrirPorta(p) }
        } else if (u.tipo === "parede") {
            const o = u.obj, a = ARMAS[o.arma]
            const tenho = j.armas.find((x) => x.id === o.arma)
            if (tenho) {
                const st = statsArma(tenho.id, tenho.nivel)
                u.custo = precoMunicao(tenho.id, tenho.nivel)
                u.texto = "Munição — " + st.nome
                if (tenho.reserva >= st.reserva && tenho.pente >= st.pente) { u.texto = "Munição cheia"; u.custo = 0; u.acao = null }
                else u.acao = () => {
                    if (!this.gastar(u.custo)) return
                    tenho.reserva = st.reserva
                    if (tenho === s && j.recarga <= 0) tenho.pente = Math.max(tenho.pente, 0)
                    this.ev({ t: "municao" })
                }
            } else {
                u.custo = a.preco
                u.texto = "Comprar " + a.nomes[0]
                u.acao = () => { if (this.gastar(a.preco)) this.darArma(o.arma) }
            }
        } else if (u.tipo === "caixa") {
            const c = this.caixa
            if (c.estado === "parada") {
                const preco = this.precoCaixa()
                u.texto = "Caixa Glitch — arma aleatória" + (preco < PRECO_CAIXA ? " (LIQUIDAÇÃO)" : "")
                u.custo = preco
                u.acao = () => { if (this.gastar(preco)) this.abrirCaixa() }
            } else if (c.estado === "pronta") {
                u.texto = "Pegar " + ARMAS[c.arma].nomes[0]
                u.custo = 0
                u.acao = () => {
                    this.darArma(c.arma)
                    c.estado = "fechando"
                    c.t = 0
                    this.ev({ t: "caixa", estado: "pegou" })
                }
            } else return null
        } else if (u.tipo === "forja") {
            if (!s) return null
            if (j.forjando > 0) return null
            const forjar = (tipo, tempo) => () => {
                if (j.recarga > 0 || j.troca > 0) return
                if (!this.gastar(u.custo)) return
                j.forjando = tempo
                j.forjaTipo = tipo
                j.mira = 0
                this.forjaT = tempo
                this.ev({ t: "forja", arma: s.id })
            }
            if (s.nivel >= MAX_NIVEL) {
                // no máximo: só dá para trocar o elemento
                u.custo = PRECO_ELEMENTO
                u.texto = "Trocar o elemento" + (s.elem ? " (" + ELEMENTOS[s.elem].nome + ")" : "")
                u.acao = forjar("elemento", 1.6)
            } else {
                const st = statsArma(s.id, s.nivel + 1)
                u.custo = PRECO_FORJA[s.nivel]
                u.texto = "Forjar " + st.nome + (s.nivel + 1 === 3 && !s.elem ? " + elemento" : "")
                u.acao = forjar("nivel", 2.4)
            }
        } else if (u.tipo === "robozinho") {
            if (u.obj.achado) return null
            u.texto = "???"
            u.custo = 0
            u.acao = () => this.acharRobozinho(u.obj)
        } else if (u.tipo === "modulo") {
            const md = u.obj.modulo
            const tem = md.max ? j.modulos[md.id] >= md.max : !!j.modulos[md.id]
            u.texto = "Módulo " + md.nome + " — " + md.desc
            u.custo = md.preco
            if (tem) { u.texto = md.nome + (md.max ? " (no máximo)" : " instalado"); u.custo = 0; u.acao = null }
            else u.acao = () => {
                if (!this.gastar(md.preco)) return
                if (md.max) j.modulos[md.id] = (j.modulos[md.id] || 0) + 1
                else j.modulos[md.id] = true
                if (md.id === "blindagem") { j.vidaMax = 250; j.vida = Math.max(j.vida, 250) }
                this.ev({ t: "modulo", id: md.id, nome: md.nome })
            }
        } else return null
        u.pode = !u.custo || j.pontos >= u.custo
        return u
    }

    /**
     * Um robozinho escondido (ou o Bjorn de pelúcia). Os 3 do nível tocam a
     * música secreta: a matilha para e dança, e cai o Booper.
     */
    acharRobozinho(o) {
        if (o.achado) return
        o.achado = true
        const n = this.mapa.objetos.filter((q) => q.tipo === "robozinho" && q.achado).length
        const total = this.mapa.objetos.filter((q) => q.tipo === "robozinho").length
        this.ev({ t: "robozinho", n: n, total: total, p: [o.cx, o.base + 0.4, o.cz], pelucia: !!o.pelucia })
        if (n < total) return
        this.ganhar(1000 * (this.nivelIdx + 1))
        this.festa = 14
        for (const e of this.monstros) if (!e.morto && !e.def.chefe && e.estado !== "surgindo") e.dancando = 14
        // o Booper cai na frente da Protogen
        const j = this.jog, fx = Math.sin(j.yaw), fz = -Math.cos(j.yaw)
        let x = j.x + fx * 1.6, z = j.z + fz * 1.6
        if (this.mapa.alt(Math.floor(x / T), Math.floor(z / T)) !== 0) { x = j.x; z = j.z }
        this.soltarPoder("booper", x, z)
        this.ev({ t: "segredo", nivel: this.nivelIdx })
    }

    abrirPorta(p) {
        this.mapa.abrirPorta(p)
        for (const a of p.areas) this.areaAberta[a] = 1
        this.campoSujo = true
        this.ev({ t: "porta", porta: p })
    }

    darArma(id) {
        const j = this.jog
        const st = statsArma(id, 1)
        const nova = { id: id, nivel: 1, pente: st.pente, reserva: st.reserva }
        let slot
        const igual = j.armas.findIndex((a) => a.id === id)
        if (igual >= 0) { j.armas[igual] = nova; slot = igual }
        else if (j.armas.length < (j.modulos.coldre ? 3 : 2)) { j.armas.push(nova); slot = j.armas.length - 1 }
        else { j.armas[j.sel] = nova; slot = j.sel }
        j.sel = slot
        j.troca = 0.25
        j.trocaPara = -1
        j.recarga = 0
        j.cad = 0.3
        this.ev({ t: "arma", id: id, nome: st.nome })
    }

    abrirCaixa() {
        const j = this.jog
        const pool = []
        for (const id in ARMAS) {
            const a = ARMAS[id]
            if (!a.caixa && !a.preco) continue
            if (j.armas.some((x) => x.id === id)) continue
            pool.push([id, a.caixa || 1])
        }
        let soma = pool.reduce((s, p) => s + p[1], 0), r = this.rand() * soma, arma = pool[0][0]
        for (const [id, peso] of pool) { r -= peso; if (r <= 0) { arma = id; break } }
        this.caixa = { estado: "girando", t: 0, arma: arma }
        this.ev({ t: "caixa", estado: "abre" })
    }

    atualizarCaixa(dt) {
        const c = this.caixa
        if (c.estado === "parada") return
        c.t += dt
        if (c.estado === "girando" && c.t >= 3.2) { c.estado = "pronta"; c.t = 0; this.ev({ t: "caixa", estado: "pronta", arma: c.arma }) }
        else if (c.estado === "pronta" && c.t >= 10) { c.estado = "fechando"; c.t = 0; this.ev({ t: "caixa", estado: "fecha" }) }
        else if (c.estado === "fechando" && c.t >= 0.8) { c.estado = "parada"; c.t = 0; c.arma = null }
    }

    // -------------------------------------------------------------- poderes

    talvezPoder(e) {
        this.semPoder++
        // o portador (dourado) e o Brutamonte sempre soltam um
        const certo = e.portador || e.tipo === "brutamonte"
        if (this.poderesNaOnda >= (certo ? 8 : 4)) return
        if (!certo && this.rand() > 0.025 && this.semPoder < 55) return
        if (this.mapa.alt(Math.floor(e.x / T), Math.floor(e.z / T)) !== 0) return
        this.semPoder = 0
        this.poderesNaOnda++
        this.soltarPoder(this.sortearPoder(), e.x, e.z)
    }

    sortearPoder() {
        const lista = Object.keys(PODERES).filter((k) => !PODERES[k].segredo && (k !== "vida" || this.jog.modulos.backup < MAX_BACKUP))
        let soma = 0
        for (const k of lista) soma += PODERES[k].peso
        let r = this.rand() * soma
        for (const k of lista) { r -= PODERES[k].peso; if (r <= 0) return k }
        return lista[0]
    }

    soltarPoder(tipo, x, z) {
        const p = { tipo: tipo, x: x, z: z, t: 0 }
        this.poderes.push(p)
        this.ev({ t: "poderSurge", p: p })
    }

    atualizarPoderes(dt) {
        const j = this.jog
        for (const p of this.poderes) {
            p.t += dt
            if (!j.morto && j.reiniciando <= 0 && Math.hypot(j.x - p.x, j.z - p.z) < 1.35 && j.y < 1.5) {
                p.fim = true
                this.pegarPoder(p)
            } else if (p.t > 26) p.fim = true
        }
        this.poderes = this.poderes.filter((p) => !p.fim)
    }

    pegarPoder(p) {
        const j = this.jog
        this.ev({ t: "poder", id: p.tipo, nome: PODERES[p.tipo].nome })
        if (p.tipo === "municao") {
            for (const a of j.armas) a.reserva = statsArma(a.id, a.nivel).reserva
            j.granadas = Math.max(j.granadas, 4)
        } else if (p.tipo === "recarga") {
            // pente e reserva cheios em todas, na hora (e as granadas)
            for (const a of j.armas) { const st = statsArma(a.id, a.nivel); a.pente = st.pente; a.reserva = st.reserva }
            j.recarga = 0
            j.granadas = Math.max(j.granadas, 4)
        } else if (PODERES[p.tipo].dura) {
            this.ativos[p.tipo] = PODERES[p.tipo].dura
            if (p.tipo === "drone" && !this.drone) {
                const o = this.olho()
                this.drone = { x: o[0], y: o[1] + 0.5, z: o[2], cad: 0.5, alvo: null }
            }
        } else if (p.tipo === "atomica") {
            this.atomica()
        } else if (p.tipo === "bonus") {
            this.ganhar(500 * (this.nivelIdx + 1))
        } else if (p.tipo === "booper") {
            this.darArma("booper")
        } else if (p.tipo === "vida") {
            j.modulos.backup = Math.min(MAX_BACKUP, j.modulos.backup + 1)
        }
    }

    /**
     * O robozinho aliado (o mesmo que flutua no pé da Protogen no widget): voa
     * no ombro dela e atira no corrompido visível mais perto.
     */
    atualizarDrone(dt) {
        const d = this.drone
        if (!d) return
        if (!(this.ativos.drone > 0)) { this.drone = null; return }
        const j = this.jog
        // na frente, à direita e um pouco acima da viseira: dá para vê-lo atirando
        const rx = Math.cos(j.yaw), rz = Math.sin(j.yaw), fx = Math.sin(j.yaw), fz = -Math.cos(j.yaw)
        let ax = j.x + rx * 1.4 + fx * 2.2, az = j.z + rz * 1.4 + fz * 2.2
        if (this.mapa.bate(ax, az, 0.15)) { ax = j.x + fx * 0.4; az = j.z + fz * 0.4 }
        if (this.mapa.bate(ax, az, 0.15)) { ax = j.x; az = j.z }
        const ay = j.y + j.olho + 0.65 + Math.sin(this.t * 2.6) * 0.08
        const k = Math.min(1, dt * 8)
        d.x += (ax - d.x) * k; d.y += (ay - d.y) * k; d.z += (az - d.z) * k
        d.cad -= dt
        if (d.cad > 0 || j.morto) return
        let alvo = null, md = 25
        for (const e of this.monstros) {
            if (e.morto || e.y < -0.5) continue
            const ey = e.y + e.def.altura * 0.6
            const dist = Math.hypot(e.x - d.x, ey - d.y, e.z - d.z)
            if (dist < md && this.mapa.visivel(d.x, d.y, d.z, e.x, ey, e.z)) { md = dist; alvo = e }
        }
        d.alvo = alvo
        if (!alvo) { d.cad = 0.15; return }
        d.cad = 0.3
        const ate = [alvo.x, alvo.y + alvo.def.altura * 0.6, alvo.z]
        this.ev({ t: "droneTiro", de: [d.x, d.y, d.z], ate: ate })
        this.ferir(alvo, vidaBase(this.g()) * 0.2 * (alvo.def.grande ? 0.5 : 1), { tipo: "drone" })
    }

    // -------------------------------------------------------------- poças de ácido

    criarPoca(x, z, r) {
        if (this.mapa.alt(Math.floor(x / T), Math.floor(z / T)) !== 0) return
        this.pocas.push({ x: x, z: z, r: r || 1.6, t: 0, dura: 7 })
        if (this.pocas.length > 14) this.pocas.shift()
        this.ev({ t: "poca", p: [x, 0, z] })
    }

    atualizarPocas(dt) {
        if (!this.pocas.length) return
        const j = this.jog
        let dentro = false
        for (const p of this.pocas) {
            p.t += dt
            if (p.t < p.dura && j.y < 0.4 && Math.hypot(j.x - p.x, j.z - p.z) < p.r * 0.9) dentro = p
        }
        this.pocas = this.pocas.filter((p) => p.t < p.dura)
        j.pocaT -= dt
        if (dentro && j.pocaT <= 0) {
            j.pocaT = 0.5
            this.ferirJogador(Math.round(7 + this.nivelIdx * 1.5), [dentro.x, dentro.z], null)
        }
    }

    /** A Bomba Atômica: os comuns morrem; os grandes perdem um pedaço, pelo nível. */
    atomica() {
        const j = this.jog, n = Math.min(this.nivelIdx, ATOMICA_GRANDES.length - 1)
        let mortos = 0
        for (const e of this.monstros) {
            if (e.morto) continue
            if (e.def.chefe) this.ferir(e, e.vidaMax * ATOMICA_CHEFE, { tipo: "emp", semPontos: true })
            else if (e.def.grande) this.ferir(e, e.vidaMax * ATOMICA_GRANDES[n], { tipo: "emp", semPontos: true })
            else { this.ferir(e, 1e9, { tipo: "emp", semPontos: true }); mortos++ }
        }
        // os tiros deles (e o ácido no chão) somem no clarão
        this.projeteis = this.projeteis.filter((q) => q.tipo === "granada" || q.tipo === "foguete")
        this.pocas = []
        this.ganhar(400 + 200 * this.nivelIdx)
        this.ev({ t: "explosao", p: [j.x, 1, j.z], raio: 30, atomica: true, mortos: mortos })
    }

    // -------------------------------------------------------------- ondas

    ondas(dt) {
        const o = this.onda
        if (this.fase !== "jogando") return
        if (o.estado === "espera") {
            o.timer -= dt
            if (o.timer <= 0) this.iniciarOnda(o.n + 1)
        } else if (o.estado === "ativa") {
            o.prox -= dt
            const vivos = this.monstros.filter((e) => !e.morto).length
            if (o.fila.length && o.prox <= 0 && vivos < o.vivosMax) {
                if (this.surgir(o.fila[0])) {
                    o.fila.shift()
                    o.prox = o.intervalo * (0.6 + this.rand() * 0.8)
                } else o.prox = 0.4
            }
            if (!o.fila.length && !this.monstros.some((e) => !e.morto)) this.fimDaOnda()
        } else if (o.estado === "nivel") {
            o.timer -= dt
            if (o.timer <= 0) {
                o.estado = "fim"
                const ultimo = this.nivelIdx + 1 >= PZ.NIVEIS.length
                this.fase = ultimo && !this.infinito ? "vitoria" : "nivelFim"
                this.stats.ondas = this.g()
                this.ev({ t: ultimo ? "vitoria" : "nivelFim" })
            }
        }
    }

    iniciarOnda(n) {
        const o = this.onda, nv = this.nivel
        o.n = n
        const g = this.g()
        const final = !this.infinito && n === nv.ondas
        o.especial = !this.infinito && nv.especiais[n] ? nv.especiais[n]
                   : (this.infinito && n % 5 === 0 ? (n % 10 === 0 ? "saltadores" : "corredores") : null)
        const fila = []
        if (o.especial) {
            const esp = ESPECIAIS[o.especial]
            const q = esp.n(g)
            for (let k = 0; k < q; k++) fila.push(esp.tipo)
            o.intervalo = esp.intervalo
        } else {
            const q = quantosNaOnda(g)
            const mist = nv.mistura(n, g)
            for (let k = 0; k < q; k++) fila.push(this.sortearTipo(mist))
            o.intervalo = Math.max(0.35, 2.1 - 0.11 * g)
            if (final) {
                // o chefe abre a última onda; os grandes comuns vêm no meio da fila
                if (MONSTROS[nv.final[0]].chefe) fila.unshift(nv.final[0])
                else {
                    const meio = Math.floor(fila.length / 2)
                    for (let k = 0; k < nv.final.length; k++) fila.splice(meio + k * 4, 0, nv.final[k])
                }
            }
            if (this.infinito && n % 5 === 3) for (let k = 0; k < 2 + Math.floor(n / 10); k++) fila.splice(Math.floor(fila.length * (k + 1) / 4), 0, "brutamonte")
            // nas ondas sem fim, um chefe de volta a cada 7 ondas
            if (this.infinito && n % 7 === 0 && !this.chefe) {
                const chefes = ["lobo", "gosma", "urso", "omega"]
                fila.unshift(chefes[Math.floor(n / 7) % chefes.length])
            }
        }
        o.fila = fila
        o.total = fila.length
        o.prox = 1.5
        o.estado = "ativa"
        o.final = final
        this.poderesNaOnda = 0
        this.ev({ t: "onda", n: n, g: g, especial: o.especial, final: final })
    }

    sortearTipo(mist) {
        let soma = 0
        for (const k in mist) soma += mist[k]
        let r = this.rand() * soma
        for (const k in mist) { r -= mist[k]; if (r <= 0) return k }
        return "corrompido"
    }

    fimDaOnda() {
        const o = this.onda, j = this.jog
        this.ev({ t: "fimOnda", n: o.n, especial: o.especial })
        if (o.especial && this.ultimaMorte) this.soltarPoder("municao", this.ultimaMorte[0], this.ultimaMorte[1])
        j.granadas = Math.min(4, j.granadas + 2)
        if (o.final) {
            o.estado = "nivel"
            o.timer = 4
        } else {
            o.estado = "espera"
            o.timer = 9
        }
    }

    // -------------------------------------------------------------- monstros

    escolherPortal(tipo) {
        const m = this.mapa, j = this.jog
        if (MONSTROS[tipo] && MONSTROS[tipo].chefe && this.nivel.chefe) {
            const c = this.nivel.chefe
            return { cx: (c.x + 0.5) * T, cz: (c.z + 0.5) * T, i: m.idx(c.x, c.z), ocupado: 0 }
        }
        const cand = []
        for (const p of m.portais) {
            if (!this.areaAberta[p.area] || p.ocupado > 0) continue
            const dc = this.campo.dist[p.i]
            if (dc === Infinity) continue
            const de = Math.hypot(p.cx - j.x, p.cz - j.z)
            if (de < 5) continue
            cand.push([dc, p])
        }
        if (!cand.length) return null
        cand.sort((a, b) => a[0] - b[0])
        const n = Math.min(cand.length, 4)
        return cand[Math.floor(this.rand() * n)][1]
    }

    surgir(tipo) {
        const p = this.escolherPortal(tipo)
        if (!p) return false
        p.ocupado = 0.9
        const def = MONSTROS[tipo]
        const g = this.g()
        let vel = def.vel || 0
        if (tipo === "corrompido") {
            const correr = clamp((g - 2) * 0.11, 0, 0.8)
            const r = this.rand()
            vel = r < correr ? 3.3 + this.rand() * 0.5 : 1.15 + this.rand() * 0.35
            if (g > 10 && this.rand() < 0.12) vel = 4.4
        } else vel *= 0.92 + this.rand() * 0.16
        if (tipo === "brutamonte") vel += Math.min(0.8, g * 0.03)
        // o chefe que volta nas ondas sem fim vem mais forte
        const vida = def.vidaFixa ? def.vidaFixa * (this.infinito ? 1 + Math.max(0, g - 31) * 0.05 : 1) : vidaBase(g) * def.vida
        const mult = DANO_NIVEL[this.nivelIdx] || DANO_NIVEL[DANO_NIVEL.length - 1]
        const e = {
            tipo: tipo, def: def, x: p.cx + (this.rand() - 0.5) * 0.4, y: -def.altura, z: p.cz + (this.rand() - 0.5) * 0.4,
            ang: Math.atan2(this.jog.x - p.cx, -(this.jog.z - p.cz)), vel: vel, vida: vida, vidaMax: vida,
            estado: "surgindo", tm: 0, flash: 0, atingido: 0, morto: false, semCabeca: false,
            ex: 0, ez: 0, vx: 0, vz: 0, passo: this.rand() * 10, alvo: null, alvoT: 0,
            recarga: 1.5 + this.rand() * 2, dano: 45 * def.dano * mult, grunhido: 1 + this.rand() * 4,
            preso: 0, ultimaPos: [p.cx, p.cz], longe: 0, semente: this.rand(), fase: 1,
            // cada um é um: a espécie (no zumbi comum), o tamanho e se manca
            variante: def.variantes ? Math.floor(this.rand() * def.variantes) : 0,
            esc: def.grande ? 1 : 0.93 + this.rand() * 0.14, manca: !def.grande && this.rand() < 0.3,
            queima: 0, queimaDps: 0, lento: 0, acelera: 0, congelado: 0, frio: 0
        }
        if (def.chefe) {
            this.chefe = e
            e.rec = { pisao: 4, rajada: 3, salto: 1.2, morteiro: 3, ninhada: 10, sopro: 5, pedra: 4 }
        }
        if (!def.grande && this.rand() < Math.min(0.1, 0.05 + 0.004 * g)) {
            e.portador = true
            e.vida = e.vidaMax = vida * 1.3
        }
        this.monstros.push(e)
        // na festa, quem chega também dança
        if (this.festa > 0 && !def.chefe) e.dancando = this.festa
        this.ev({ t: "surge", e: e })
        return true
    }

    monstro(e, dt) {
        e.flash = Math.max(0, e.flash - dt * 7)
        e.atingido = Math.max(0, e.atingido - dt * 3)
        e.tm += dt
        if (e.estado === "morrendo") {
            if (e.tm > 2.6) e.remover = true
            return
        }
        if (e.estado === "surgindo") {
            const k = clamp(e.tm / e.def.surge, 0, 1)
            e.y = -e.def.altura * (1 - k) * (1 - k)
            if (k >= 1) { e.y = 0; e.estado = "andando"; e.tm = 0 }
            return
        }
        if (e.coracao > 0) e.coracao -= dt
        // dançando (a festa dos robozinhos): parado, só balança
        if (e.dancando > 0) {
            e.dancando -= dt
            e.vx = e.vz = 0
            if (e.queima > 0) { e.queima -= dt; this.ferir(e, e.queimaDps * dt, { tipo: "fogo", silencioso: true }) }
            return
        }
        // o fogo queima mesmo congelado
        if (e.queima > 0) {
            e.queima -= dt
            this.ferir(e, e.queimaDps * Math.min(dt, e.queima + dt), { tipo: "fogo", silencioso: true })
            if (e.morto) return
        }
        if (this.ativos.congelar > 0) {
            if (!e.def.chefe) { e.vx = e.vz = 0; return }
            dt *= 0.4
        }
        if (e.congelado > 0) {
            e.congelado -= dt
            e.vx = e.vz = 0
            return
        }
        if (e.lento > 0) e.lento -= dt
        if (e.acelera > 0) e.acelera -= dt
        if (e.estado === "saltando") return this.passoSalto(e, dt)
        const j = this.jog
        const dx = j.x - e.x, dz = j.z - e.z, dist = Math.hypot(dx, dz)
        const alcance = e.def.alcance + e.def.raio + RAIO_JOG
        const vivo = !j.morto && j.reiniciando <= 0
        e.recarga -= dt
        e.grunhido -= dt
        if (e.grunhido <= 0) { e.grunhido = 3 + this.rand() * 5; this.ev({ t: "grunhido", e: e }) }

        let querVel = 0, querAng = null

        if (e.def.chefe) {
            const r = this.chefeIA(e, dt, dx, dz, dist, alcance, vivo)
            if (!r) return
            querVel = r[0]; querAng = r[1]
        } else switch (e.estado) {
            case "andando": {
                const ataca = vivo && dist < alcance && j.y < 1.3
                if (ataca && e.tipo === "bomba") { e.estado = "pavio"; e.tm = 0; this.ev({ t: "pavio", e: e }); break }
                if (ataca) { e.estado = "atacando"; e.tm = 0; e.bateu = false; break }
                if (e.tipo === "bomba" && vivo && dist < 2.4) { e.estado = "pavio"; e.tm = 0; this.ev({ t: "pavio", e: e }); break }
                if (e.tipo === "cuspidor" && vivo && e.recarga <= 0 && dist > 4 && dist < 19 &&
                    this.mapa.visivel(e.x, e.y + 1.75, e.z, j.x, j.y + 1.2, j.z)) {
                    e.estado = "cuspindo"; e.tm = 0; e.bateu = false
                    break
                }
                if (e.tipo === "brutamonte" && vivo && e.recarga <= 0 && dist > 4.5 && dist < 15 &&
                    this.mapa.livre(e.x, e.z, j.x, j.z, e.def.raio * 0.8)) {
                    e.estado = "preparando"; e.tm = 0
                    this.ev({ t: "rugido", e: e })
                    break
                }
                // o coelho: de meia distância, agacha e dá o bote
                if (e.tipo === "saltador" && vivo && e.recarga <= 0 && dist > 3.2 && dist < 11 && j.y < 1 &&
                    this.pontoDoSalto(e)) {
                    e.estado = "agachando"; e.tm = 0
                    break
                }
                // o uivador: vendo a Protogen, uiva e acelera a matilha
                if (e.tipo === "uivador" && vivo && e.recarga <= 0 && dist < 22 &&
                    this.mapa.visivel(e.x, e.y + 1.7, e.z, j.x, j.y + 1.2, j.z)) {
                    e.estado = "uivando"; e.tm = 0; e.bateu = false
                    break
                }
                const alvo = this.alvoCaminho(e, dt, dist)
                querVel = e.vel
                if (e.tipo === "cuspidor" && dist < 11 && vivo && this.mapa.visivel(e.x, e.y + 1.75, e.z, j.x, j.y + 1.2, j.z)) querVel = 0
                if (alvo) querAng = Math.atan2(alvo[0] - e.x, -(alvo[1] - e.z))
                break
            }
            case "atacando": {
                querAng = Math.atan2(dx, -dz)
                if (!e.bateu && e.tm >= e.def.preparo) {
                    e.bateu = true
                    this.ev({ t: "ataque", e: e })
                    if (vivo && dist < alcance + 0.5 && j.y < 1.5 && Math.abs(angDif(e.ang, Math.atan2(dx, -dz))) < 1.2)
                        this.ferirJogador(Math.round(e.dano), [e.x, e.z], null)
                }
                if (e.tm >= e.def.preparo + e.def.recupera) { e.estado = "andando"; e.tm = 0 }
                break
            }
            case "pavio": {
                querVel = dist > 1.3 ? e.vel * 0.45 : 0
                querAng = Math.atan2(dx, -dz)
                if (e.tm >= e.def.preparo && !e.explodiu) {
                    e.explodiu = true
                    this.matar(e, { tipo: "emp", semPontos: true })
                }
                break
            }
            case "cuspindo": {
                querAng = Math.atan2(dx, -dz)
                if (!e.bateu && e.tm >= 0.55) {
                    e.bateu = true
                    const ox = e.x + Math.sin(e.ang) * 0.4, oz = e.z - Math.cos(e.ang) * 0.4, oy = e.y + 1.7
                    const tx = j.x + j.vx * 0.25, tz = j.z + j.vz * 0.25, ty = j.y + 1.1
                    const l = Math.hypot(tx - ox, ty - oy, tz - oz) || 1, v = 10
                    this.projeteis.push({ tipo: "cuspe", x: ox, y: oy, z: oz, vx: (tx - ox) / l * v, vy: (ty - oy) / l * v,
                                          vz: (tz - oz) / l * v, vida: 4, dano: Math.round(e.dano * 0.55) })
                    this.ev({ t: "cuspe", p: [ox, oy, oz] })
                }
                if (e.tm >= 1.0) { e.estado = "andando"; e.tm = 0; e.recarga = 2.4 + this.rand() * 1.6 }
                break
            }
            case "agachando": {
                querAng = Math.atan2(dx, -dz)
                if (e.tm >= 0.42) {
                    e.recarga = 3.5 + this.rand() * 2.5
                    if (!this.comecarSalto(e, 1.3)) { e.estado = "andando"; e.tm = 0; e.recarga = 1.2 }
                    return
                }
                break
            }
            case "uivando": {
                querAng = Math.atan2(dx, -dz)
                if (!e.bateu && e.tm >= 0.5) {
                    e.bateu = true
                    for (const o of this.monstros)
                        if (!o.morto && !o.def.grande && Math.hypot(o.x - e.x, o.z - e.z) < 10) o.acelera = 6
                    this.ev({ t: "uivoMonstro", e: e })
                }
                if (e.tm >= 1.5) { e.estado = "andando"; e.tm = 0; e.recarga = 9 + this.rand() * 4 }
                break
            }
            case "preparando": {
                querAng = Math.atan2(dx, -dz)
                if (e.tm >= 0.9) { e.estado = "investida"; e.tm = 0; e.dirX = Math.sin(e.ang); e.dirZ = -Math.cos(e.ang); e.bateu = false }
                break
            }
            case "investida": {
                // corre reto; curva só um pouco
                const desejado = Math.atan2(dx, -dz)
                e.ang += clamp(angDif(e.ang, desejado), -dt * 0.6, dt * 0.6)
                e.dirX = Math.sin(e.ang); e.dirZ = -Math.cos(e.ang)
                const v = 10 * (e.lento > 0 ? 0.6 : 1)
                const p = { x: e.x + e.dirX * v * dt, z: e.z + e.dirZ * v * dt }
                const bateu = this.mapa.resolver(p, e.def.raio)
                e.x = p.x; e.z = p.z
                if (!e.bateu && vivo && dist < e.def.raio + RAIO_JOG + 0.45 && j.y < 1.6) {
                    e.bateu = true
                    this.ferirJogador(Math.round(e.dano * 1.15), [e.x, e.z], [e.dirX * 11, e.dirZ * 11])
                    e.estado = "recuperando"; e.tm = 0
                } else if (bateu || e.tm > 1.4) {
                    e.estado = bateu ? "atordoado" : "recuperando"; e.tm = 0
                    e.atordoadoDura = 1.5
                    if (bateu) this.ev({ t: "pancada", e: e })
                }
                e.recarga = 4 + this.rand() * 3
                return this.fimDoMonstro(e, dt, 0, null, true)
            }
            case "atordoado": {
                if (e.tm >= (e.atordoadoDura || 1.5)) { e.estado = "andando"; e.tm = 0 }
                break
            }
            case "recuperando": {
                if (e.tm >= 0.7) { e.estado = "andando"; e.tm = 0 }
                break
            }
            default: {
                e.estado = "andando"; e.tm = 0
            }
        }
        // lento (gelo) e acelerado (uivo)
        if (e.lento > 0) querVel *= 0.5
        if (e.acelera > 0) querVel *= 1.45
        this.fimDoMonstro(e, dt, querVel, querAng, false)
    }

    // -------------------------------------------------------------- o salto (coelho e Lobo Alfa)

    /**
     * Começa o bote: um arco até onde a Protogen vai estar (um pouco antes,
     * para cair do lado dela). Devolve false se o caminho não está livre.
     */
    comecarSalto(e, altura) {
        const alvo = this.pontoDoSalto(e)
        if (!alvo) return false
        const tx = alvo[0], tz = alvo[1], len = alvo[2]
        e.salto = { sx: e.x, sz: e.z, tx: tx, tz: tz, h: altura, dur: clamp(0.45 + len * 0.035, 0.5, 1.1) }
        e.ang = Math.atan2(tx - e.x, -(tz - e.z))
        e.estado = "saltando"
        e.tm = 0
        e.vx = e.vz = 0
        this.ev({ t: "salto", e: e })
        return true
    }

    /**
     * Onde o bote cai: onde ela vai estar (ou onde está), um pouco antes,
     * para cair do lado dela. null se o caminho até lá não está livre.
     */
    pontoDoSalto(e) {
        const j = this.jog
        const r = e.def.raio * 0.85
        for (const [px, pz] of [[j.x + j.vx * 0.35, j.z + j.vz * 0.35], [j.x, j.z]]) {
            const len = Math.hypot(px - e.x, pz - e.z)
            if (len < 0.5) continue
            const curto = Math.min(len - 0.2, e.def.raio + RAIO_JOG)
            const tx = px - (px - e.x) / len * curto, tz = pz - (pz - e.z) / len * curto
            if (this.mapa.livre(e.x, e.z, tx, tz, r)) return [tx, tz, len]
        }
        return null
    }

    passoSalto(e, dt) {
        const s = e.salto
        const k = Math.min(1, e.tm / s.dur)
        const p = { x: s.sx + (s.tx - s.sx) * k, z: s.sz + (s.tz - s.sz) * k }
        this.mapa.resolver(p, e.def.raio)
        e.x = p.x; e.z = p.z
        e.y = 4 * s.h * k * (1 - k)
        e.passo += dt * 3
        if (k < 1) return
        e.y = 0
        e.salto = null
        e.estado = "recuperando"
        e.tm = 0
        const j = this.jog
        const vivo = !j.morto && j.reiniciando <= 0
        const dx = j.x - e.x, dz = j.z - e.z, dist = Math.hypot(dx, dz), l = dist || 1
        if (e.def.chefe) {
            // o Lobo Alfa cai com tudo: uma onda de choque pequena
            this.ondasDeChoque.push({ x: e.x, z: e.z, r: 0.5, vel: 13, max: 7, dano: Math.round(e.dano * 0.6), acertou: false })
            this.ev({ t: "pisao", p: [e.x, 0, e.z], pequeno: true })
            if (vivo && dist < 2.6 && j.y < 1.5) this.ferirJogador(Math.round(e.dano * 1.1), [e.x, e.z], [dx / l * 9, dz / l * 9])
            e.rec.salto = (6 + this.rand() * 2) / [1, 1, 1.2, 1.45][e.fase]
        } else {
            this.ev({ t: "aterrissou", e: e })
            if (vivo && dist < e.def.raio + RAIO_JOG + 0.7 && j.y < 1.2)
                this.ferirJogador(Math.round(e.dano * 1.1), [e.x, e.z], [dx / l * 5, dz / l * 5])
        }
    }

    /** Gira, anda, colide, e confere se ele não ficou preso. */
    fimDoMonstro(e, dt, querVel, querAng, jaMoveu) {
        if (querAng !== null && querAng !== undefined) {
            const giro = (e.def.grande ? 3 : 7) * dt
            e.ang += clamp(angDif(e.ang, querAng), -giro, giro)
        }
        if (!jaMoveu) {
            const fx = Math.sin(e.ang), fz = -Math.cos(e.ang)
            // anda para onde olha (gira primeiro, se a curva for fechada)
            const alinhado = querAng === null || querAng === undefined ? 1 : clamp(1.4 - Math.abs(angDif(e.ang, querAng)), 0, 1)
            const v = querVel * alinhado
            e.vx += (fx * v - e.vx) * Math.min(1, dt * 8)
            e.vz += (fz * v - e.vz) * Math.min(1, dt * 8)
            e.ex *= Math.max(0, 1 - dt * 6)
            e.ez *= Math.max(0, 1 - dt * 6)
            const p = { x: e.x + (e.vx + e.ex) * dt, z: e.z + (e.vz + e.ez) * dt }
            this.mapa.resolver(p, e.def.raio)
            e.x = p.x; e.z = p.z
        }
        e.passo += Math.hypot(e.vx, e.vz) * dt
        if (!isFinite(e.x) || !isFinite(e.z)) {
            // nunca deveria acontecer; se acontecer, ele volta para um portal
            this.reposicionar(e)
        }
        this.vigiarPreso(e, dt)
    }

    /** Para onde ir agora: direto na Protogen se der, senão descendo o campo. */
    alvoCaminho(e, dt, dist) {
        const j = this.jog
        e.alvoT -= dt
        if (e.alvo && e.alvoT > 0 && e.alvoV === this.campo.versao) return e.alvo
        e.alvoT = 0.18 + this.rand() * 0.1
        e.alvoV = this.campo.versao
        const r = e.def.raio * 0.95
        if (dist < 16 && this.mapa.livre(e.x, e.z, j.x, j.z, r)) {
            e.alvo = [j.x, j.z]
            return e.alvo
        }
        let tx = Math.floor(e.x / T), tz = Math.floor(e.z / T)
        if (!this.mapa.dentro(tx, tz) || this.campo.dist[this.mapa.idx(tx, tz)] === Infinity) {
            e.alvo = [j.x, j.z]
            return e.alvo
        }
        let melhor = null, primeiro = null
        for (let k = 0; k < 6; k++) {
            const n = this.campo.proximo(tx, tz)
            if (!n) break
            tx = n[0]; tz = n[1]
            const wx = (tx + 0.5) * T, wz = (tz + 0.5) * T
            if (!primeiro) primeiro = [wx, wz]
            if (this.mapa.livre(e.x, e.z, wx, wz, r)) melhor = [wx, wz]
            else break
        }
        e.alvo = melhor || primeiro || [j.x, j.z]
        return e.alvo
    }

    /**
     * A rede de segurança: monstro que não sai do lugar por 6 s longe da
     * Protogen (ou que ficou longe demais por muito tempo) volta por um portal
     * mais perto — se ela não estiver olhando.
     */
    vigiarPreso(e, dt) {
        e.vigia = (e.vigia || 0) + dt
        if (e.vigia < 2) return
        e.vigia = 0
        const j = this.jog
        const andou = Math.hypot(e.x - e.ultimaPos[0], e.z - e.ultimaPos[1])
        e.ultimaPos = [e.x, e.z]
        const dist = Math.hypot(j.x - e.x, j.z - e.z)
        const parado = e.estado === "andando" && andou < 0.4 && dist > 3.5 && e.vel > 0 &&
                       !(e.tipo === "cuspidor" && dist < 12)
        e.preso = parado ? e.preso + 1 : 0
        const longe = this.campo.em(e.x, e.z) * T > 70
        e.longe = longe ? e.longe + 1 : 0
        if (e.preso >= 3 || e.longe >= 5 || this.mapa.bate(e.x, e.z, 0.05)) {
            if (e.def.chefe && !this.mapa.bate(e.x, e.z, 0.05)) { e.preso = 0; return }
            const visto = this.mapa.visivel(j.x, j.y + j.olho, j.z, e.x, e.y + 1.2, e.z)
            if (!visto || this.mapa.bate(e.x, e.z, 0.05)) this.reposicionar(e)
        }
    }

    reposicionar(e) {
        const p = this.escolherPortal(e.def.chefe ? "x" : e.tipo)
        if (!p) return
        e.x = p.cx; e.z = p.cz; e.vx = e.vz = e.ex = e.ez = 0
        e.y = -e.def.altura
        e.estado = "surgindo"; e.tm = 0; e.salto = null
        e.preso = 0; e.longe = 0; e.alvo = null
        e.ultimaPos = [e.x, e.z]
        this.ev({ t: "reposicionado", e: e })
    }

    separar() {
        const ms = this.monstros
        for (let a = 0; a < ms.length; a++) {
            const A = ms[a]
            if (A.morto || A.estado === "surgindo" || A.estado === "saltando") continue
            for (let b = a + 1; b < ms.length; b++) {
                const B = ms[b]
                if (B.morto || B.estado === "surgindo" || B.estado === "saltando") continue
                const r = A.def.raio + B.def.raio
                const dx = B.x - A.x, dz = B.z - A.z, d2 = dx * dx + dz * dz
                if (d2 >= r * r) continue
                let d = Math.sqrt(d2), nx, nz
                if (d < 1e-4) { const a2 = this.rand() * 6.28; nx = Math.cos(a2); nz = Math.sin(a2); d = 0 }
                else { nx = dx / d; nz = dz / d }
                const empurra = (r - d) * 0.5
                // o grande quase não se mexe
                const wa = A.def.grande && !B.def.grande ? 0.15 : B.def.grande && !A.def.grande ? 0.85 : 0.5
                const pa = { x: A.x - nx * empurra * 2 * wa, z: A.z - nz * empurra * 2 * wa }
                const pb = { x: B.x + nx * empurra * 2 * (1 - wa), z: B.z + nz * empurra * 2 * (1 - wa) }
                this.mapa.resolver(pa, A.def.raio)
                this.mapa.resolver(pb, B.def.raio)
                A.x = pa.x; A.z = pa.z; B.x = pb.x; B.z = pb.z
            }
        }
    }

    // -------------------------------------------------------------- o chefe

    /**
     * Os chefes. A parte comum (o golpe de perto e o rugido de quando muda de
     * fase) fica aqui; cada um tem as suas armas:
     *   omega  pisão (onda de choque) e rajada de orbes que seguem
     *   lobo   o bote (salto com onda de choque) e o uivo que chama a matilha
     *   gosma  morteiro de ácido (poças no chão) e a ninhada de inchados
     *   urso   sopro glacial (cone que deixa lenta), pedra de gelo e pisão
     * Devolve [velocidade, ângulo], ou null se ele já se moveu sozinho.
     */
    chefeIA(e, dt, dx, dz, dist, alcance, vivo) {
        const j = this.jog
        for (const k in e.rec) e.rec[k] -= dt
        const rapidez = [1, 1, 1.2, 1.45][e.fase]
        const praEla = Math.atan2(dx, -dz)
        switch (e.estado) {
            case "atacando": {
                if (!e.bateu && e.tm >= e.def.preparo / rapidez) {
                    e.bateu = true
                    this.ev({ t: "ataque", e: e })
                    if (vivo && dist < alcance + 0.8 && j.y < 2 && Math.abs(angDif(e.ang, praEla)) < 1.3) {
                        const l = dist || 1
                        this.ferirJogador(Math.round(e.dano * 1.2), [e.x, e.z], [dx / l * 9, dz / l * 9])
                    }
                }
                if (e.tm >= (e.def.preparo + e.def.recupera) / rapidez) { e.estado = "andando"; e.tm = 0 }
                return [0, praEla]
            }
            case "invocando": {
                if (e.tm >= 1.6) { e.estado = "andando"; e.tm = 0 }
                return [0, praEla]
            }
            case "recuperando": {
                if (e.tm >= 0.7) { e.estado = "andando"; e.tm = 0 }
                return [0, null]
            }
            case "pisao": {
                if (!e.bateu && e.tm >= 1.1) {
                    e.bateu = true
                    this.ondasDeChoque.push({ x: e.x, z: e.z, r: 0.5, vel: 11 * rapidez, max: 15, dano: Math.round(e.dano * 0.85),
                                              acertou: false, lento: e.tipo === "urso" ? 2.5 : 0 })
                    this.ev({ t: "pisao", p: [e.x, 0, e.z], gelo: e.tipo === "urso" })
                }
                if (e.tm >= 1.8) { e.estado = "andando"; e.tm = 0; e.rec.pisao = (e.tipo === "urso" ? 9 : 7) / rapidez }
                return [0, null]
            }
        }
        if (e.estado === "andando") {
            if (vivo && dist < alcance && j.y < 2) { e.estado = "atacando"; e.tm = 0; e.bateu = false; return [0, null] }
        }
        const ia = e.tipo === "lobo" ? this.iaLobo : e.tipo === "gosma" ? this.iaGosma : e.tipo === "urso" ? this.iaUrso : this.iaOmega
        const r = ia.call(this, e, dt, dist, vivo, rapidez, praEla)
        if (r !== undefined) return r
        if (e.estado === "andando") {
            const alvo = this.alvoCaminho(e, dt, dist)
            return [e.vel * rapidez, alvo ? Math.atan2(alvo[0] - e.x, -(alvo[1] - e.z)) : null]
        }
        e.estado = "andando"
        return [0, null]
    }

    /** Ela está à vista da altura `h` dele? */
    chefeVe(e, h) {
        const j = this.jog
        return this.mapa.visivel(e.x, e.y + h, e.z, j.x, j.y + 1.2, j.z)
    }

    iaOmega(e, dt, dist, vivo, rapidez, praEla) {
        const j = this.jog
        if (e.estado === "andando") {
            if (vivo && dist < 9 && e.rec.pisao <= 0) {
                e.estado = "pisao"; e.tm = 0; e.bateu = false
                this.ev({ t: "rugido", e: e })
                return [0, null]
            }
            if (vivo && dist > 5 && dist < 30 && e.rec.rajada <= 0 && this.chefeVe(e, 3.9)) {
                e.estado = "rajada"; e.tm = 0; e.tiros = 0
                return [0, null]
            }
            return undefined
        }
        if (e.estado === "rajada") {
            const n = [0, 3, 5, 7][e.fase]
            const cada = 0.22
            while (e.tiros < n && e.tm >= 0.6 + e.tiros * cada) {
                e.tiros++
                const ox = e.x + Math.sin(e.ang) * 0.6, oz = e.z - Math.cos(e.ang) * 0.6, oy = e.y + 3.9
                const espalha = (e.tiros - (n + 1) / 2) * 0.12
                const a = Math.atan2(j.x - ox, -(j.z - oz)) + espalha
                const hd = Math.hypot(j.x - ox, j.z - oz) || 1
                const vy = (j.y + 1.2 - oy) / hd
                const v = 12
                const l = Math.hypot(1, vy)
                this.projeteis.push({ tipo: "orbe", x: ox, y: oy, z: oz, vx: Math.sin(a) * v / l, vy: vy * v / l,
                                      vz: -Math.cos(a) * v / l, vida: 5, dano: Math.round(e.dano * 0.5), segue: 1.2 })
                this.ev({ t: "cuspe", p: [ox, oy, oz], chefe: true })
            }
            if (e.tm >= 0.6 + n * cada + 0.5) { e.estado = "andando"; e.tm = 0; e.rec.rajada = (4.5 + this.rand() * 2) / rapidez }
            return [0, praEla]
        }
        return undefined
    }

    iaLobo(e, dt, dist, vivo, rapidez, praEla) {
        if (e.estado === "andando") {
            if (vivo && e.rec.salto <= 0 && dist > 3 && dist < 18 && this.jog.y < 1 && this.pontoDoSalto(e)) {
                e.estado = "agachando"; e.tm = 0
                this.ev({ t: "rugido", e: e })
                return [0, praEla]
            }
            return undefined
        }
        if (e.estado === "agachando") {
            if (e.tm >= 0.75 / rapidez) {
                if (!this.comecarSalto(e, 2.2)) { e.estado = "andando"; e.tm = 0; e.rec.salto = 1.5 }
                return null
            }
            return [0, praEla]
        }
        if (e.estado === "saltando") { this.passoSalto(e, dt); return null }
        return undefined
    }

    iaGosma(e, dt, dist, vivo, rapidez, praEla) {
        const j = this.jog
        if (e.estado === "andando") {
            if (vivo && e.fase >= 2 && e.rec.ninhada <= 0) {
                e.estado = "chocando"; e.tm = 0; e.bateu = false
                this.ev({ t: "rugido", e: e })
                return [0, praEla]
            }
            if (vivo && e.rec.morteiro <= 0 && dist > 3.5 && dist < 30 && this.chefeVe(e, 2.9)) {
                e.estado = "morteiro"; e.tm = 0; e.bateu = false
                return [0, praEla]
            }
            return undefined
        }
        if (e.estado === "morteiro") {
            if (!e.bateu && e.tm >= 0.75) {
                e.bateu = true
                const n = [0, 3, 5, 7][e.fase]
                const ox = e.x + Math.sin(e.ang) * 0.9, oz = e.z - Math.cos(e.ang) * 0.9, oy = e.y + 2.9
                for (let k = 0; k < n; k++) {
                    // o primeiro vai nela; os outros caem em volta
                    const ang = this.rand() * Math.PI * 2, raio = k === 0 ? 0 : 1 + this.rand() * 2.8
                    let tx = j.x + j.vx * 0.5 + Math.cos(ang) * raio, tz = j.z + j.vz * 0.5 + Math.sin(ang) * raio
                    if (this.mapa.alt(Math.floor(tx / T), Math.floor(tz / T)) !== 0) { tx = j.x; tz = j.z }
                    this.lancarArco("acido", ox, oy, oz, tx, tz, Math.round(e.dano * 0.45))
                }
                this.ev({ t: "cuspe", p: [ox, oy, oz], chefe: true, acido: true })
            }
            if (e.tm >= 1.4) { e.estado = "andando"; e.tm = 0; e.rec.morteiro = (4.5 + this.rand() * 1.5) / rapidez }
            return [0, praEla]
        }
        if (e.estado === "chocando") {
            if (!e.bateu && e.tm >= 1.0) {
                e.bateu = true
                const n = e.fase >= 3 ? 4 : 3
                for (let k = 0; k < n; k++) this.onda.fila.unshift("bomba")
                this.ev({ t: "ninhada", e: e, n: n })
            }
            if (e.tm >= 1.5) { e.estado = "andando"; e.tm = 0; e.rec.ninhada = 14 / rapidez }
            return [0, praEla]
        }
        return undefined
    }

    iaUrso(e, dt, dist, vivo, rapidez, praEla) {
        const j = this.jog
        if (e.estado === "andando") {
            if (vivo && e.fase >= 2 && dist < 9 && e.rec.pisao <= 0) {
                e.estado = "pisao"; e.tm = 0; e.bateu = false
                this.ev({ t: "rugido", e: e })
                return [0, null]
            }
            if (vivo && e.rec.sopro <= 0 && dist < 8.5 && this.chefeVe(e, 3.2)) {
                e.estado = "soprando"; e.tm = 0; e.soproT = 0; e.soprou = false
                return [0, praEla]
            }
            if (vivo && e.rec.pedra <= 0 && dist > 7 && dist < 30 && this.chefeVe(e, 3.6)) {
                e.estado = "arremessando"; e.tm = 0; e.bateu = false
                return [0, praEla]
            }
            return undefined
        }
        if (e.estado === "soprando") {
            // vira devagar enquanto sopra: dá para fugir pelo lado
            e.ang += clamp(angDif(e.ang, praEla), -dt * 0.9, dt * 0.9)
            if (e.tm >= 0.7) {
                if (!e.soprou) { e.soprou = true; this.ev({ t: "sopro", e: e }) }
                e.soproT -= dt
                if (e.soproT <= 0) {
                    e.soproT = 0.15
                    const dif = Math.abs(angDif(e.ang, praEla))
                    if (vivo && dist < 9.5 && dif < 0.42 && j.y < 2.5 && this.chefeVe(e, 3.2)) {
                        if (this.ferirJogador(Math.round(e.dano * 0.1), [e.x, e.z], null)) j.lento = Math.max(j.lento, 1.8)
                    }
                }
            }
            if (e.tm >= 2.4) { e.estado = "andando"; e.tm = 0; e.soprou = false; e.rec.sopro = (7 + this.rand() * 2) / rapidez }
            this.fimDoMonstro(e, dt, 0, null, false)
            return null
        }
        if (e.estado === "arremessando") {
            if (!e.bateu && e.tm >= 0.9) {
                e.bateu = true
                const ox = e.x + Math.sin(e.ang) * 0.6, oz = e.z - Math.cos(e.ang) * 0.6, oy = e.y + 3.9
                this.lancarArco("pedra", ox, oy, oz, j.x + j.vx * 0.6, j.z + j.vz * 0.6, Math.round(e.dano * 0.8))
                this.ev({ t: "arremesso", e: e })
            }
            if (e.tm >= 1.4) { e.estado = "andando"; e.tm = 0; e.rec.pedra = (5.5 + this.rand() * 2) / rapidez }
            return [0, praEla]
        }
        return undefined
    }

    /** Um projétil em arco (ácido, pedra de gelo) que cai em (tx, tz). */
    lancarArco(tipo, ox, oy, oz, tx, tz, dano) {
        const G = 14
        const d = Math.hypot(tx - ox, tz - oz)
        // o tempo de voo cresce com a distância; o arco não pode bater no teto
        let tv = clamp(0.6 + d * 0.035, 0.7, 1.4)
        let vy = -oy / tv + G * tv / 2
        while (tv > 0.5 && oy + vy * vy / (2 * G) > this.mapa.teto - 0.3) {
            tv -= 0.05
            vy = -oy / tv + G * tv / 2
        }
        this.projeteis.push({ tipo: tipo, x: ox, y: oy, z: oz, vx: (tx - ox) / tv, vy: vy, vz: (tz - oz) / tv,
                              vida: 4, dano: dano, grav: G, girar: 0 })
    }

    faseDoChefe(e) {
        const k = e.vida / e.vidaMax
        const nova = k < 0.33 ? 3 : k < 0.66 ? 2 : 1
        if (nova <= e.fase) return
        e.fase = nova
        // no meio do salto, ele termina o salto antes de rugir
        if (e.estado !== "saltando") { e.estado = "invocando"; e.tm = 0 }
        // o alfa sai do uivo direto para o bote
        if (e.tipo === "lobo") e.rec.salto = 0
        const lista = (INVOCA[e.tipo] || INVOCA.omega)[nova - 2]
        for (let i = 0; i < lista.length; i += 2)
            for (let n = 0; n < lista[i + 1]; n++) this.onda.fila.unshift(lista[i])
        this.ev({ t: "chefeFase", fase: nova, frase: e.def.frases[1] })
    }

    moverOndasDeChoque(dt) {
        const j = this.jog
        for (const o of this.ondasDeChoque) {
            const antes = o.r
            o.r += o.vel * dt
            const d = Math.hypot(j.x - o.x, j.z - o.z)
            if (!o.acertou && d >= antes - 0.5 && d <= o.r + 0.5 && j.y < 0.45 &&
                this.mapa.visivel(o.x, 0.5, o.z, j.x, 0.5, j.z)) {
                o.acertou = true
                const l = d || 1
                if (this.ferirJogador(o.dano, [o.x, o.z], [(j.x - o.x) / l * 8, (j.z - o.z) / l * 8]) && o.lento)
                    j.lento = Math.max(j.lento, o.lento)
                j.vy = Math.max(j.vy, 4)
                j.chao = false
            }
            if (o.r > o.max) o.fim = true
        }
        this.ondasDeChoque = this.ondasDeChoque.filter((o) => !o.fim)
    }

    // -------------------------------------------------------------- projéteis

    moverProjeteis(dt) {
        const j = this.jog, m = this.mapa
        for (const p of this.projeteis) {
            p.vida -= dt
            if (p.tipo === "granada") {
                p.vy -= 14 * dt
                const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt
                if (m.alt(Math.floor(nx / T), Math.floor(p.z / T)) > p.y) { p.vx *= -0.45 } else p.x = nx
                if (m.alt(Math.floor(p.x / T), Math.floor(nz / T)) > p.y) { p.vz *= -0.45 } else p.z = nz
                p.y += p.vy * dt
                if (p.y < 0.08) {
                    p.y = 0.08
                    if (Math.abs(p.vy) > 1.5) this.ev({ t: "quica", p: [p.x, p.y, p.z] })
                    p.vy = Math.abs(p.vy) * 0.35
                    p.vx *= 0.6; p.vz *= 0.6
                }
                if (p.y > m.teto - 0.1) { p.y = m.teto - 0.1; p.vy = -Math.abs(p.vy) * 0.3 }
                p.girar += dt * Math.hypot(p.vx, p.vz) * 2
                if (p.vida <= 0) {
                    p.fim = true
                    this.explosao(p.x, p.y + 0.3, p.z, 5, 200 + 80 * this.g())
                }
                continue
            }
            const v = Math.hypot(p.vx, p.vy, p.vz)
            const d = [p.vx / v, p.vy / v, p.vz / v]
            const passo = v * dt
            if (p.tipo === "coracao") {
                // o coração do Booper atravessa a fila: um boop em cada um
                const parede = m.raio(p.x, p.y, p.z, d[0], d[1], d[2], passo)
                const ate = Math.min(passo, parede.t)
                for (const e of this.monstros) {
                    if (e.morto || p.atingidos.has(e) || p.fura <= 0) continue
                    if (!this.raioMonstro(e, [p.x, p.y, p.z], d, ate)) continue
                    p.atingidos.add(e)
                    p.fura--
                    this.boop(e, p.dano)
                }
                p.girar += dt * 9
                if (parede.t < passo || p.vida <= 0 || p.fura <= 0) {
                    p.fim = true
                    this.ev({ t: "coracaoFim", p: [p.x + d[0] * ate, p.y + d[1] * ate, p.z + d[2] * ate] })
                } else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt }
                continue
            }
            if (p.tipo === "foguete") {
                const parede = m.raio(p.x, p.y, p.z, d[0], d[1], d[2], passo)
                let hit = null
                for (const e of this.monstros) {
                    if (e.morto) continue
                    const h = this.raioMonstro(e, [p.x, p.y, p.z], d, Math.min(passo, parede.t))
                    if (h && (!hit || h.t < hit.t)) hit = h
                }
                const t = hit ? hit.t : parede.t
                if (hit || parede.t < passo || p.vida <= 0) {
                    p.fim = true
                    const ex = p.x + d[0] * (t - 0.05), ey = p.y + d[1] * (t - 0.05), ez = p.z + d[2] * (t - 0.05)
                    this.explosao(ex, Math.max(0.2, ey), ez, p.raio, p.dano)
                } else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt }
                continue
            }
            // cuspe, orbe, ácido e pedra: dos monstros, contra a Protogen (congelados no ar)
            if (this.ativos.congelar > 0) continue
            if (p.grav) { this.moverArco(p, dt); continue }
            if (p.segue && !j.morto) {
                const tx = j.x - p.x, ty = j.y + 1.1 - p.y, tz = j.z - p.z, tl = Math.hypot(tx, ty, tz) || 1
                const k = Math.min(1, p.segue * dt)
                p.vx += (tx / tl * v - p.vx) * k
                p.vy += (ty / tl * v - p.vy) * k
                p.vz += (tz / tl * v - p.vz) * k
            }
            const parede = m.raio(p.x, p.y, p.z, d[0], d[1], d[2], passo)
            // distância do segmento do projétil ao corpo dela (um bastão vertical)
            const nx = p.x + d[0] * Math.min(passo, parede.t), ny = p.y + d[1] * Math.min(passo, parede.t), nz = p.z + d[2] * Math.min(passo, parede.t)
            const acertou = !j.morto && j.reiniciando <= 0 && distSegBastao(p.x, p.y, p.z, nx, ny, nz, j.x, j.y + 0.2, j.y + j.olho + 0.1, j.z) < 0.55
            if (acertou) {
                p.fim = true
                this.ferirJogador(p.dano, [p.x, p.z], null)
                this.ev({ t: "respingo", p: [nx, ny, nz], chefe: p.tipo === "orbe" })
            } else if (parede.t < passo || p.vida <= 0) {
                p.fim = true
                this.ev({ t: "respingo", p: [nx, ny, nz], chefe: p.tipo === "orbe" })
            } else { p.x = nx; p.y = ny; p.z = nz }
        }
        this.projeteis = this.projeteis.filter((p) => !p.fim)
    }

    /** O ácido da Matriarca e a pedra do Urso: caem com a gravidade e estouram no chão, na parede ou nela. */
    moverArco(p, dt) {
        const j = this.jog, m = this.mapa
        p.vy -= p.grav * dt
        p.girar += dt * 8
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt
        const v = Math.hypot(p.vx, p.vy, p.vz) || 1, passo = v * dt
        const parede = m.raio(p.x, p.y, p.z, p.vx / v, p.vy / v, p.vz / v, passo)
        const k = Math.min(1, parede.t / passo)
        const ex = p.x + (nx - p.x) * k, ey = p.y + (ny - p.y) * k, ez = p.z + (nz - p.z) * k
        const vivo = !j.morto && j.reiniciando <= 0
        const acertou = vivo && distSegBastao(p.x, p.y, p.z, ex, ey, ez, j.x, j.y + 0.2, j.y + j.olho + 0.1, j.z) < 0.6
        if (!acertou && parede.t >= passo && ny > 0.05 && p.vida > 0) {
            p.x = nx; p.y = ny; p.z = nz
            if (p.y > m.teto - 0.1) { p.y = m.teto - 0.1; p.vy = -Math.abs(p.vy) * 0.3 }
            return
        }
        p.fim = true
        // onde estourou: um pouco antes da parede, para não ficar dentro dela
        let bx = acertou ? j.x : ex, bz = acertou ? j.z : ez
        if (!acertou && parede.n && parede.t < passo) { bx += parede.n[0] * 0.3; bz += parede.n[2] * 0.3 }
        if (m.alt(Math.floor(bx / T), Math.floor(bz / T)) !== 0) { bx = p.x; bz = p.z }
        const dist = Math.hypot(j.x - bx, j.z - bz)
        if (p.tipo === "acido") {
            this.criarPoca(bx, bz, 1.6)
            if (vivo && (acertou || (dist < 1.4 && j.y < 1))) this.ferirJogador(p.dano, [bx, bz], null)
            this.ev({ t: "respingo", p: [bx, Math.max(0.1, ey), bz], acido: true })
        } else {
            // a pedra de gelo: estilhaça, machuca em volta e deixa lenta
            if (vivo && (acertou || (dist < 3 && j.y < 1.5))) {
                const kd = acertou ? 1 : 1 - dist / 3 * 0.5
                if (this.ferirJogador(Math.round(p.dano * kd), [bx, bz], [(j.x - bx) / (dist || 1) * 5, (j.z - bz) / (dist || 1) * 5]))
                    j.lento = Math.max(j.lento, 3)
            }
            this.ev({ t: "estilhaco", p: [bx, Math.max(0.3, ey), bz] })
        }
    }
}

/** Distância (aproximada por amostras) do segmento a ao bastão vertical em (bx, bz). */
function distSegBastao(ax, ay, az, cx, cy, cz, bx, y0, y1, bz) {
    let melhor = Infinity
    for (let i = 0; i <= 6; i++) {
        const k = i / 6
        const x = ax + (cx - ax) * k, y = ay + (cy - ay) * k, z = az + (cz - az) * k
        const yy = clamp(y, y0, y1)
        const d = Math.hypot(x - bx, y - yy, z - bz)
        if (d < melhor) melhor = d
    }
    return melhor
}

PZ.Jogo = Jogo
PZ.Mapa = Mapa
PZ.Campo = Campo
PZ.ARMAS = ARMAS
PZ.MONSTROS = MONSTROS
PZ.MODULOS = MODULOS
PZ.PODERES = PODERES
PZ.PRECO_FORJA = PRECO_FORJA
PZ.PRECO_CAIXA = PRECO_CAIXA
PZ.PRECO_ELEMENTO = PRECO_ELEMENTO
PZ.MAX_NIVEL = MAX_NIVEL
PZ.ELEMENTOS = ELEMENTOS
PZ.ESPECIAIS = ESPECIAIS
PZ.statsArma = statsArma
PZ.sorteio = sorteio
PZ.vidaBase = vidaBase

})(typeof window !== "undefined" ? (window.PZ = window.PZ || {}) : (globalThis.PZ = globalThis.PZ || {}))
