/*
 * Protocolo Z — os níveis. Cada mapa é uma grade de ladrilhos de 2 m, escrita
 * à mão em texto (linha = z, coluna = x):
 *
 *   #  parede                    .  chão
 *   P  onde a Protogen começa     L  chão com luminária no teto
 *   s  portal de onde os corrompidos sobem
 *   a-f  porta (letras iguais são a mesma porta; o preço vai em `portas`)
 *   1-9  arma de parede (numa parede; a arma vai em `armasParede`)
 *   M  Caixa Glitch (a caixa misteriosa)   F  Forja (melhora a arma)
 *   H  Blindagem   B  Backup   T  Turbo   O  Overclock   V  Propulsor
 *   K  Coldre Extra (terceira arma)   J  Presas de Titânio (garra mais forte)
 *   C  coluna   X  caixotes   =  bancada   N  o núcleo (só no último)
 *   Y  vaso de planta (Estufa)   Q  cápsula criogênica (Criogenia)
 *
 * `robozinhos`: os 3 robozinhos escondidos do nível ([x, z]; podem estar em
 * cima de uma bancada, de um vaso, de uma cápsula). Achar os 3 é o segredo.
 *
 * As áreas são o que as portas separam: os portais de uma área só acordam
 * quando ela é aberta. `testes/teste.js` confere que tudo é alcançável.
 */
(function (PZ) {
"use strict"

PZ.NIVEIS = [
    {
        id: "laboratorio",
        nome: "Laboratório",
        sub: "Ala de pesquisa — setor 7",
        ondas: 5,
        teto: 3.4,
        // a cor do ar, a luz que sobra no escuro e a das luminárias
        neblina: [0.035, 0.05, 0.075], densidade: 0.03,
        ambiente: [0.16, 0.19, 0.25],
        lampada: [0.75, 0.95, 1.15],
        portal: [1.0, 0.18, 0.35],
        tema: "lab",
        // os 3 robozinhos escondidos: atrás da coluna, numa bancada e num canto do depósito
        robozinhos: [[1, 8], [29, 8], [34, 16]],
        portas: { a: 750, b: 1000, c: 1000 },
        armasParede: { 1: "enxame", 2: "lanca", 3: "estilhaco", 4: "uivo" },
        mistura: function (n) {
            return { corrompido: 1, bomba: n >= 3 ? 0.08 : 0, saltador: n >= 4 ? 0.06 : 0 }
        },
        // a última onda traz o primeiro Touro, no meio da fila
        final: ["brutamonte"],
        especiais: {},
        mapa: [
            "#####1######4#########2#############",
            "#s.......L......s#s.......L.......s#",
            "#................#.................#",
            "#..C........C....#...==.....==.....#",
            "#................#...==.....==....H#",
            "#........L.......a.................#",
            "#.......P........a........L........#",
            "#................#...==.....==.....#",
            "#..C........C....#...==.....==.....#",
            "#B...............#.................#",
            "#s.......L......s#s.......L.......s#",
            "#######ccc########bbb###############",
            "#s................................s#",
            "#..XX....XX....XX....XX....XX......#",
            "#...........L..........L...........#",
            "#M................................F#",
            "#...........L..........L...........#",
            "#..XX....XX....XX....XX....XX......#",
            "#s................................s#",
            "#################3##################"
        ]
    },
    {
        id: "fabrica",
        nome: "Fábrica",
        sub: "Linha de montagem abandonada",
        ondas: 6,
        teto: 4.2,
        neblina: [0.07, 0.045, 0.03], densidade: 0.026,
        ambiente: [0.22, 0.17, 0.13],
        lampada: [1.25, 0.85, 0.45],
        portal: [1.0, 0.25, 0.1],
        tema: "fabrica",
        // numa bancada da linha de cima e nos cantos das duas alas
        robozinhos: [[11, 3], [1, 14], [40, 14]],
        portas: { a: 1000, b: 1000, c: 1250, d: 1250 },
        armasParede: { 6: "estilhaco", 7: "enxame", 8: "lanca", 9: "ferrao" },
        mistura: function (n) {
            return { corrompido: 1, corredor: 0.14, cuspidor: n >= 2 ? 0.1 : 0, bomba: 0.08, saltador: 0.06,
                     brutamonte: n >= 4 ? 0.02 : 0 }
        },
        final: ["lobo"],
        especiais: { 3: "corredores" },
        chefe: { x: 20, z: 8 },
        mapa: [
            "####################9#####################",
            "#s........L..........L..........L.......s#",
            "#O......................................V#",
            "#...==....==....M.........F....==....==..#",
            "#........................................#",
            "#s........L..........L..........L.......s#",
            "####cccc######################dddd########",
            "#s..........s#s............s#s..........s#",
            "#............#..............#............#",
            "#..XX....XX..#....L....L....#..CC....CC..#",
            "#..XX....XX..#..............#..CC....CC..#",
            "#J....L......a..............b......L.....#",
            "#............a......P.......b............#",
            "#..XX....XX..#..............#..CC....CC..#",
            "#..XX....XX..#....L....L....#..CC....CC..#",
            "#T...........#B.............#...........H#",
            "#s....L.....s#s............s#s....L.....s#",
            "######6#############7#############8#######"
        ]
    },
    {
        id: "estufa",
        nome: "Estufa",
        sub: "Viveiro hidropônico — a gosma tomou conta",
        ondas: 6,
        teto: 6.0,
        neblina: [0.03, 0.06, 0.035], densidade: 0.028,
        ambiente: [0.14, 0.22, 0.15],
        lampada: [0.9, 1.15, 0.6],
        portal: [0.6, 1.0, 0.15],
        tema: "estufa",
        // no meio dos vasos, na ala leste e numa bancada do porão
        robozinhos: [[27, 8], [38, 11], [24, 20]],
        portas: { a: 1000, b: 1000, c: 1250, d: 1250 },
        armasParede: { 1: "lanca", 2: "uivo", 3: "enxame", 4: "ferrao", 5: "estilhaco", 6: "lanca" },
        mistura: function (n) {
            return { corrompido: 1, corredor: 0.12, cuspidor: 0.16, bomba: 0.12, saltador: 0.08,
                     uivador: n >= 2 ? 0.05 : 0, brutamonte: n >= 4 ? 0.02 : 0 }
        },
        final: ["gosma"],
        especiais: { 3: "saltadores" },
        chefe: { x: 20, z: 3 },
        mapa: [
            "####3##########1########2##########4####",
            "#s.....s#s....................s#s.....s#",
            "#.......#......L........L......#.......#",
            "#.......#......................#.......#",
            "#H..L...#...YY...YY...YY..YY...#...L..T#",
            "#.......#......................#.......#",
            "#.......a..........L...........b.......#",
            "#M......a......................b......F#",
            "#.......#...YY...YY...YY..YY...#.......#",
            "#.......#......................#.......#",
            "#J..L...#...........P..........#...L..V#",
            "#.......#.....L..........L.....#.......#",
            "#.......#......................#.......#",
            "#s.....s#s....................s#s.....s#",
            "############ccc##########ddd############",
            "#s.................B..................s#",
            "#......................................#",
            "#..............==......==..............#",
            "#.....XX..L........L.........L..XX.....#",
            "#O....XX........................XX....K#",
            "#..............==......==..............#",
            "#......................................#",
            "#s.................s..................s#",
            "##########5##################6##########"
        ]
    },
    {
        id: "criogenia",
        nome: "Criogenia",
        sub: "Câmara fria — os que dormiam acordaram",
        ondas: 7,
        teto: 5.5,
        neblina: [0.05, 0.07, 0.1], densidade: 0.024,
        ambiente: [0.2, 0.25, 0.32],
        lampada: [0.75, 0.95, 1.3],
        portal: [0.35, 0.75, 1.3],
        tema: "gelo",
        // em cima de uma cápsula, e nos cantos das alas oeste e leste
        robozinhos: [[27, 16], [1, 19], [42, 5]],
        portas: { a: 1250, b: 1250, c: 1000, d: 1000 },
        armasParede: { 1: "lanca", 2: "enxame", 3: "ferrao", 4: "estilhaco", 5: "uivo", 6: "lanca" },
        mistura: function (n) {
            return { corrompido: 1, corredor: 0.16, cuspidor: 0.1, bomba: 0.1, saltador: 0.12, uivador: 0.07,
                     brutamonte: n >= 4 ? 0.025 : 0 }
        },
        final: ["urso"],
        especiais: { 3: "corredores", 5: "saltadores" },
        chefe: { x: 21, z: 8 },
        mapa: [
            "######1##################3###########2######",
            "#s.........s#s.......K........s#s.........s#",
            "#...........#..................#...........#",
            "#...........#...==...L....==..J#...........#",
            "#...........#..................#...........#",
            "#.....L.....#s................s#.....L.....#",
            "#H..........########aaaa########..........T#",
            "#...........#s................s#...........#",
            "#...X.......#..................#.......X...#",
            "#...X.......#...Q..Q....Q..Q...#.......X...#",
            "#...........#..................#...........#",
            "#...........#.....L......L.....#...........#",
            "#M....s.....c....C........C....d.....s....F#",
            "#...........c..................d...........#",
            "#...........#.....L......L.....#...........#",
            "#...........#........P.........#...........#",
            "#...X.......#...Q..Q....Q..Q...#.......X...#",
            "#...X.......#..................#.......X...#",
            "#B..........#s................s#..........O#",
            "#.....L.....########bbbb########.....L.....#",
            "#...........#s................s#...........#",
            "#...........#..................#...........#",
            "#...........#........L.....L...#...........#",
            "#...........#..................#...........#",
            "#s.........s#s.......V........s#s.........s#",
            "######5##########4###################6######"
        ]
    },
    {
        id: "nucleo",
        nome: "Núcleo",
        sub: "A origem do vírus",
        ondas: 7,
        teto: 6.5,
        neblina: [0.06, 0.02, 0.06], densidade: 0.022,
        ambiente: [0.2, 0.12, 0.22],
        lampada: [1.1, 0.45, 0.95],
        portal: [1.0, 0.1, 0.25],
        tema: "nucleo",
        // dois robozinhos nas alas e, em cima dos caixotes, o Bjorn de pelúcia
        robozinhos: [[1, 20], [38, 4], [34, 18, "pelucia"]],
        portas: { a: 1000, b: 1000, c: 1000, d: 1000 },
        armasParede: { 1: "lanca", 2: "enxame", 3: "estilhaco" },
        mistura: function (n) {
            return { corrompido: 1, corredor: 0.16, cuspidor: 0.12, bomba: 0.1, saltador: 0.1, uivador: 0.07,
                     brutamonte: n >= 3 ? 0.03 : 0 }
        },
        final: ["omega"],
        especiais: { 4: "corredores" },
        // onde o chefe sobe (ladrilho)
        chefe: { x: 19, z: 4 },
        mapa: [
            "########################################",
            "#s......s#s........L.........s#s......s#",
            "#........#....................#........#",
            "#..L.....#....................#.....L..#",
            "#........a....................b........#",
            "#M.......a.....L........L.....b.......H#",
            "#........#....C..........C....#........#",
            "#..XX....#....................#..XX....#",
            "#..XX....#....................#..XX....#",
            "#K.......#....................#.......J#",
            "#...L....#s.......L..L.......s#....L...#",
            "#........#....................#........#",
            "#F.......#.........NN.........#.......T#",
            "#........#.........NN.........#........#",
            "#........#....................#........#",
            "#...L....#s.......L..L.......s#....L...#",
            "#........#.........P..........#........#",
            "#..XX....#....................#..XX....#",
            "#..XX....#....C..........C....#..XX....#",
            "#O.......c....................d.......B#",
            "#........c.....L........L.....d........#",
            "#..L.....#....................#.....L..#",
            "#........#....................#........#",
            "#s......s#s........L.........s#s......s#",
            "####1##############2###############3####"
        ]
    }
]

})(typeof window !== "undefined" ? (window.PZ = window.PZ || {}) : (globalThis.PZ = globalThis.PZ || {}))
