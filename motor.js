/*
 * Motor do simulador de monitoramento contínuo de uma passarela metálica de
 * pedestres, com indicadores por sensor para o modelo IFC (gêmeo digital).
 *
 * Simulação virtual: a passarela, o fluxo de pessoas, os acelerômetros, a
 * temperatura e uma perda de rigidez são simulados; não há conexão com a
 * estrutura real. Os modos, o amortecimento e as amplitudes por sensor foram
 * calibrados pelo trecho de vibração livre de um ensaio real (1.000 Hz, três
 * acelerômetros); o vão vem do modelo IFC.
 *
 * Fluxo de pessoas: travessias sorteadas por hora (perfil diário com picos),
 * grupos maiores nos picos, peso e ritmo de passo sorteados. A medição usa o
 * trecho de vibração livre logo após uma travessia, com a passarela vazia; no
 * pico pode não haver trecho livre. Cada trecho é identificado pelo método do
 * ensaio (remoção da média, janela de Hamming, zero-padding, FFT de 0 a 50 Hz,
 * maior pico), com interpolação parabólica opcional do pico. Por dia, cada
 * Sensor_ID recebe um estado (BASELINE, NORMAL, ATENÇÃO, ALERTA) por dois
 * critérios: sem e com compensação de temperatura.
 *
 * ensaioVirtual() gera, para uma hora escolhida, a resposta forçada pelos
 * passos das pessoas (soma de respostas impulsivas dos modos), para animação.
 *
 * Determinístico: a mesma semente produz a mesma saída. Sem dependências.
 * Funciona no navegador (window.Motor) e em CommonJS (module.exports).
 *
 * Uso: const r = Motor.simular(Motor.PARAM_PADRAO);
 *      r.sensores[0].ind.com.atraso_dias, r.snapshot (formato sensors.json)
 *      const e = Motor.ensaioVirtual(Motor.PARAM_PADRAO, 0, 8);   // dia 1, 8 h
 *
 * Unidades: frequências em Hz, acelerações em g, tempos em s ou dias, °C, kg, m.
 */
(function (raiz, fabrica) {
  const M = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else raiz.Motor = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Parâmetros padrão (descritos no README); passarela_padrao.json é uma cópia.
  const PARAM_PADRAO = {
    semente: 2026,
    dias: 60,
    dias_baseline: 14,
    vao_m: 11.95,                 // comprimento das vigas no modelo IFC
    largura_m: 1.70,              // largura da chapa de piso no modelo IFC (área útil de 20,3 m²)
    aquisicao: { fs_hz: 1000, janela_s: 4.1, f_max_hz: 50 },
    medicoes_max_por_hora: 1,     // trechos de vibração livre analisados por hora
    // calibrados pelo ensaio (trecho de vibração livre de 402,4 a 406,5 s); posicao_m: distância ao apoio.
    // Sensores acrescentados sem amplitudes_g recebem a amplitude pela forma do modo (prepararSensores).
    modos: [
      { f_hz: 7.93457, amortecimento: 0.01468 },
      { f_hz: 9.765625, amortecimento: 0.01066 }
    ],
    sensores: [
      { sensor_id: 'ACC_MV_01', canal: 'A1272_18A', posicao: 'Meio do vão', posicao_m: 5.975, amplitudes_g: [0.04988, 0.01969] },
      { sensor_id: 'ACC_QV_01', canal: 'A1274_18A', posicao: '1/4 do vão', posicao_m: 2.99, amplitudes_g: [0.02930, 0.01155] },
      { sensor_id: 'ACC_AP_01', canal: 'A1275_18A', posicao: 'Apoio', posicao_m: 0.36, amplitudes_g: [0.00121, 0.00051] }
    ],
    f_mef_hz: 6.91394,
    fluxo: {
      // travessias por hora, de 0 h a 23 h (picos de manhã, no almoço e no fim da tarde)
      travessias_por_hora: [0, 0, 0, 0, 0, 1, 4, 25, 40, 15, 10, 12, 30, 35, 12, 10, 12, 25, 40, 20, 8, 5, 2, 1],
      grupo_extra_fora_pico: 0.3,  // média de pessoas além da primeira (Poisson), fora de pico
      grupo_extra_pico: 2.0,       // idem, na hora de maior fluxo
      peso_medio_kg: 70, peso_desvio_kg: 12,
      passo_hz: [1.6, 2.2], comprimento_passo_m: 0.7,
      intervalo_grupo_s: 0.6,      // distância, em tempo, entre fileiras do mesmo grupo
      lado_a_lado_max: 4,          // pessoas lado a lado numa fileira (largura de 1,70 m)
      pico_1_pessoa_g: 0.08        // aceleração de pico no meio do vão com uma pessoa (estimada)
    },
    ruido_g: 0.0003,
    dispersao_amplitude: 0.25,    // desvio do log da amplitude além do efeito do peso
    repetibilidade: 0.0005,       // desvio relativo da frequência entre medições
    temperatura: {
      ref_c: 22, ciclo_diario_c: 6, oscilacao_c: 1.5, periodo_oscilacao_dias: 9,
      aquecimento_c: 4, ruido_c: 0.8, atraso_h: 2, erro_termometro_c: 0.5,
      coef_por_c: -0.001           // cerca de -0,1% por °C (Moser e Moaveni, 2011)
    },
    dano: { inicio_dia: 40, fim_dia: 50, perda_rigidez: 0.01 },
    criterio: { k_atencao: 2, k_alerta: 3, persistencia_dias: 2, interpolacao: true },
    // Semáforo nas cabeceiras: limiares [AMARELO, VERMELHO]; null = sem esse nível. Pedestres sozinhos
    // acendem no máximo o AMARELO (abuso); o VERMELHO vem do vento forte, da ocupação com chuva ou vento
    // e da estrutura. Valores de referência, a confirmar com o grupo de estruturas.
    semaforo: {
      pico_ms2: [2.5, null],       // aceleração de pico (limite de desconforto do Sétra)
      ocupacao_pm2: [0.5, null],   // pessoas por m² (densidade de referência do Sétra)
      ocupacao_clima_pm2: 0.75,    // VERMELHO da ocupação com chuva ou vento em AMARELO (hipotético)
      chuva_mmh: [10, null],       // hipotético
      vento_ms: [15, 20],          // hipotético
      histerese: 0.1,              // a cor só baixa com o valor 10% abaixo do limiar...
      tempo_amarelo_s: 10,         // ...por este tempo, para sair do AMARELO
      tempo_vermelho_s: 20         // ...e por este, para sair do VERMELHO
    },
    // Flecha no meio do vão: viga biapoiada equivalente, soma das cargas dos pedestres (linha de
    // influência). Com massa_kg_m > 0, EI é calibrado pela massa e pela frequência do ensaio,
    // EI = m·(2·f1·L²/π)²; com massa_kg_m = 0, EI é o das longarinas (E·I·n). Limiares: L/350
    // (NBR 8800:2024, vigas de piso de edificações, por analogia) acende o VERMELHO; 80% dele, o AMARELO.
    flecha: {
      massa_kg_m: 255,             // aço no IFC parcial: 0,389 m³ × 7850 kg/m³ / 11,95 m (a confirmar)
      E_pa: 210e9,
      I_perfil_m4: 1.0784649e-4,   // perfil do modelo numérico: altura de 330 mm, mesas de 160 × 11 mm, alma de 7,5 mm
      longarinas: 2,
      limite_razao: 350,
      fracao_amarelo: 0.8
    },
    // Cenários hipotéticos do ensaio virtual
    cenarios: {
      multidao_pessoas: 25, multidao_chegada_s: 15,
      chuva_max_mmh: 30, vento_max_ms: 18,
      parada_pessoas: 110          // multidão parada: pessoas de peso médio espalhadas pelo vão
    }
  };

  const ESTADOS = ['BASELINE', 'NORMAL', 'ATENÇÃO', 'ALERTA'];
  const CORES = ['VERDE', 'AMARELO', 'VERMELHO'];

  // Sensores sem amplitude medida: amplitude do sensor de referência (o primeiro, no meio do vão)
  // vezes a razão das formas do 1º modo, sen(πx/L). A forma do 2º modo não foi medida; usa-se a mesma.
  function prepararSensores(p) {
    const ref = p.sensores[0], L = p.vao_m, fRef = Math.sin(Math.PI * ref.posicao_m / L);
    p.sensores.forEach(s => {
      if (!s.amplitudes_g) {
        const f = Math.sin(Math.PI * Math.min(Math.max(s.posicao_m, 0), L) / L) / fRef;
        s.amplitudes_g = ref.amplitudes_g.map(a => a * f);
      }
    });
    return p;
  }

  // ---------------------------------------------------------------------------
  // Números aleatórios (mulberry32 + Box-Muller)
  // ---------------------------------------------------------------------------
  function gerador(semente) {
    let s = semente >>> 0;
    let reserva = null;
    const u = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const normal = () => {
      if (reserva !== null) { const r = reserva; reserva = null; return r; }
      let a = 0;
      while (a === 0) a = u();
      const b = u(), m = Math.sqrt(-2 * Math.log(a));
      reserva = m * Math.sin(2 * Math.PI * b);
      return m * Math.cos(2 * Math.PI * b);
    };
    const poisson = (lambda) => {
      if (lambda <= 0) return 0;
      const L = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= u(); } while (p > L);
      return k - 1;
    };
    return { u, normal, poisson };
  }

  // ---------------------------------------------------------------------------
  // FFT radix-2 (in-place) e identificação
  // ---------------------------------------------------------------------------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let tam = 2; tam <= n; tam <<= 1) {
      const ang = -2 * Math.PI / tam, wr = Math.cos(ang), wi = Math.sin(ang), meio = tam >> 1;
      for (let i = 0; i < n; i += tam) {
        let cr = 1, ci = 0;
        for (let k = 0; k < meio; k++) {
          const a = i + k, b = a + meio;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  // Espectro de amplitude pelo método do ensaio (export_tdms.py).
  function espectro(sinal, fs, fMax) {
    const n = sinal.length;
    let media = 0;
    for (let i = 0; i < n; i++) media += sinal[i];
    media /= n;
    let nfft = 1;
    while (nfft < n) nfft <<= 1;
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    let somaJanela = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
      somaJanela += w;
      re[i] = (sinal[i] - media) * w;
    }
    fft(re, im);
    const df = fs / nfft, m = Math.floor(fMax / df) + 1;
    const f = new Float64Array(m), amp = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      f[k] = k * df;
      amp[k] = 2 * Math.hypot(re[k], im[k]) / somaJanela;
    }
    return { f, amp, df };
  }

  // Maior pico acima de 1 Hz: na grade e com interpolação parabólica (log da amplitude).
  function picoDominante(esp) {
    const { f, amp, df } = esp;
    let i = -1, max = -1;
    for (let k = 0; k < f.length; k++) if (f[k] >= 1 && amp[k] > max) { max = amp[k]; i = k; }
    let fInterp = f[i];
    if (i > 0 && i < amp.length - 1) {
      const y0 = Math.log(amp[i - 1] + 1e-15), y1 = Math.log(amp[i] + 1e-15), y2 = Math.log(amp[i + 1] + 1e-15);
      const den = y0 - 2 * y1 + y2;
      if (den !== 0) fInterp = f[i] + 0.5 * (y0 - y2) / den * df;
    }
    return { f_grade: f[i], f_interp: fInterp, amplitude: max };
  }

  // Cinco maiores picos com exclusão de ±0,8 Hz (find_peaks do ensaio).
  function picos(esp, quantos = 5) {
    const a = Array.from(esp.amp), saida = [];
    for (let q = 0; q < quantos; q++) {
      let i = -1, max = -1;
      for (let k = 0; k < a.length; k++) if (esp.f[k] >= 1 && a[k] > max) { max = a[k]; i = k; }
      if (i < 0) break;
      saida.push({ frequency_hz: +esp.f[i].toFixed(6), amplitude_g: +max.toFixed(9) });
      for (let k = 0; k < a.length; k++) if (Math.abs(esp.f[k] - esp.f[i]) < 0.8) a[k] = 0;
    }
    return saida;
  }

  // ---------------------------------------------------------------------------
  // Fluxo de pessoas
  // ---------------------------------------------------------------------------
  // Travessias de uma hora (h = índice da hora desde o início). Sorteio próprio por hora,
  // para que a simulação de 60 dias e o ensaio virtual vejam as mesmas travessias.
  function fluxoHora(p, h) {
    const F = p.fluxo, rng = gerador((p.semente * 7919 + h * 104729) >>> 0);
    const taxas = F.travessias_por_hora, taxa = taxas[h % 24] || 0;
    const maxTaxa = Math.max(...taxas, 1e-9);
    const extra = F.grupo_extra_fora_pico + (F.grupo_extra_pico - F.grupo_extra_fora_pico) * taxa / maxTaxa;
    const n = rng.poisson(taxa), lista = [];
    for (let i = 0; i < n; i++) {
      const pessoas = 1 + rng.poisson(extra);
      const pesos = [];
      for (let k = 0; k < pessoas; k++) pesos.push(Math.max(35, F.peso_medio_kg + F.peso_desvio_kg * rng.normal()));
      const passo = F.passo_hz[0] + (F.passo_hz[1] - F.passo_hz[0]) * rng.u();
      const t0 = 3600 * rng.u(), sentido = rng.u() < 0.5 ? 1 : -1;
      lista.push(travessia(p, t0, pesos, passo, sentido, p.semente * 7919 + h * 104729 + i * 31 + 17));
    }
    return lista.sort((a, b) => a.t0 - b.t0);
  }

  // Uma travessia (grupo). O grupo anda em fileiras de 2 a lado_a_lado_max pessoas (a largura permite
  // até 4), separadas por intervalo_grupo_s; na mesma fileira, cada pessoa tem um atraso próprio de até
  // 0,3 s, para os passos não ficarem em fase. A passada varia ±15% entre grupos (velocidades
  // diferentes). Sorteio próprio (semente), para não alterar os demais sorteios.
  // porFileira: força o número de pessoas lado a lado (usado nas cenas roteirizadas).
  function travessia(p, t0, pesos, passo, sentido, semente, rotulo, porFileira) {
    const F = p.fluxo, r = gerador(semente >>> 0), n = pesos.length;
    const max = Math.max(1, Math.round(F.lado_a_lado_max || 1));
    const sorteio = n === 1 || max === 1 ? 1 : Math.min(n, 2 + Math.floor(r.u() * (max - 1)));
    const largura = porFileira ? Math.min(n, porFileira, max) : sorteio;
    const atrasos = [], faixas = [];
    for (let k = 0; k < n; k++) {
      const faixa = k % largura;
      atrasos.push(Math.floor(k / largura) * F.intervalo_grupo_s + (faixa ? 0.3 * r.u() : 0));
      faixas.push(faixa);
    }
    const v = passo * F.comprimento_passo_m * (0.85 + 0.3 * r.u());
    return { t0, fim: t0 + p.vao_m / v + Math.max(...atrasos), pesos, peso_total: pesos.reduce((s, x) => s + x, 0),
      passo_hz: passo, v_ms: v, sentido, atrasos, faixas, rotulo };
  }

  // Trechos de vibração livre: a passarela fica vazia por pelo menos uma janela após a travessia.
  function janelasLivres(p, travessias) {
    const J = p.aquisicao.janela_s, saida = [];
    for (const c of travessias) {
      const ini = c.fim, fim = c.fim + J;
      if (fim > 3600) continue;
      const ocupada = travessias.some(o => o !== c && o.t0 < fim && o.fim > ini);
      if (!ocupada) saida.push({ t: ini, travessia: c });
    }
    return saida;
  }

  // ---------------------------------------------------------------------------
  // Modelo da passarela, da temperatura e do dano
  // ---------------------------------------------------------------------------
  function temperaturaAr(p, dia, hora, rng) {
    const T = p.temperatura;
    const media = T.ref_c + T.aquecimento_c * dia / p.dias +
      T.oscilacao_c * Math.sin(2 * Math.PI * dia / T.periodo_oscilacao_dias);
    return media + T.ciclo_diario_c * Math.sin(2 * Math.PI * (hora - 9) / 24) + T.ruido_c * rng.normal();
  }

  function perdaRigidez(p, dia) {
    const D = p.dano;
    if (dia <= D.inicio_dia || D.perda_rigidez <= 0) return 0;
    return D.perda_rigidez * Math.min(1, (dia - D.inicio_dia) / Math.max(D.fim_dia - D.inicio_dia, 1e-9));
  }

  function vibracaoLivre(p, s, fatorF, fatorA, rng) {
    const fs = p.aquisicao.fs_hz, n = Math.round(p.aquisicao.janela_s * fs);
    const a = new Float64Array(n);
    p.modos.forEach((m, j) => {
      const w = 2 * Math.PI * m.f_hz * fatorF, wd = w * Math.sqrt(1 - m.amortecimento ** 2);
      const fase = 2 * Math.PI * rng.u(), A = s.amplitudes_g[j] * fatorA;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        a[i] += A * Math.exp(-m.amortecimento * w * t) * Math.sin(wd * t + fase);
      }
    });
    for (let i = 0; i < n; i++) a[i] += p.ruido_g * rng.normal();
    return a;
  }

  // ---------------------------------------------------------------------------
  // Critério de estado por dia
  // ---------------------------------------------------------------------------
  function regressao(x, y) {
    const n = x.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const a = sxx > 0 ? sxy / sxx : 0;
    return { a, b: my - a * mx };
  }

  function mediaDesvio(v) {
    const n = v.length;
    const m = v.reduce((s, x) => s + x, 0) / n;
    const d = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(n - 1, 1));
    return { m, d };
  }

  // Dias sem medição (NaN) repetem o estado anterior.
  function classificar(p, diario) {
    const C = p.criterio, nb = p.dias_baseline;
    const { m: mu, d: sigma } = mediaDesvio(diario.slice(0, nb).filter(Number.isFinite));
    const z = diario.map(v => Number.isFinite(v) && sigma > 0 ? (v - mu) / sigma : NaN);
    const estado = [];
    z.forEach((zd, d) => {
      if (d < nb) { estado.push('BASELINE'); return; }
      if (!Number.isFinite(zd)) { estado.push(estado[d - 1]); return; }
      let persiste = d - C.persistencia_dias + 1 >= nb;
      for (let k = 0; k < C.persistencia_dias && persiste; k++) if (!(Math.abs(z[d - k]) > C.k_alerta)) persiste = false;
      if (persiste) estado.push('ALERTA');
      else if (Math.abs(zd) > C.k_atencao) estado.push('ATENÇÃO');
      else estado.push('NORMAL');
    });
    return { diario, mu, sigma, z, estado };
  }

  function indicadores(p, estado) {
    const nb = p.dias_baseline, ini = Math.floor(p.dano.inicio_dia);
    let atencao = 0, alerta = 0, atraso = null;
    for (let d = nb; d < Math.min(ini, p.dias); d++) {
      if (estado[d] === 'ATENÇÃO') atencao++;
      if (estado[d] === 'ALERTA') alerta++;
    }
    if (p.dano.perda_rigidez > 0) {
      for (let d = Math.max(ini, nb); d < p.dias; d++) if (estado[d] === 'ALERTA') { atraso = d + 1 - p.dano.inicio_dia; break; }
    }
    return { atencao_falsos: atencao, alerta_falsos: alerta, atraso_dias: atraso };
  }

  // Temperatura do ar, da estrutura (com atraso) e medida, hora a hora.
  function temperaturas(p, rng) {
    const T = p.temperatura, nH = p.dias * 24;
    const ar = new Float64Array(nH), estrutura = new Float64Array(nH), medida = new Float64Array(nH);
    for (let h = 0; h < nH; h++) ar[h] = temperaturaAr(p, h / 24, h % 24, rng);
    const atraso = Math.round(T.atraso_h);
    for (let h = 0; h < nH; h++) {
      estrutura[h] = ar[Math.max(0, h - atraso)];
      medida[h] = ar[h] + T.erro_termometro_c * rng.normal();
    }
    return { ar, estrutura, medida };
  }

  // Fator na frequência: temperatura da estrutura e perda de rigidez.
  const fatorFrequencia = (p, tEstrutura, dia) =>
    (1 + p.temperatura.coef_por_c * (tEstrutura - p.temperatura.ref_c)) * Math.sqrt(1 - perdaRigidez(p, dia));

  // ---------------------------------------------------------------------------
  // Simulação do monitoramento contínuo
  // ---------------------------------------------------------------------------
  function simular(param) {
    const p = prepararSensores(JSON.parse(JSON.stringify(param || PARAM_PADRAO)));
    const rng = gerador(p.semente);
    const fs = p.aquisicao.fs_hz, nS = p.sensores.length, nH = p.dias * 24;
    const temp = temperaturas(p, rng);

    const sens = p.sensores.map(s => ({
      sensor_id: s.sensor_id, canal: s.canal, posicao: s.posicao,
      dia: [], temp: [], f_real: [], f_grade: [], f_interp: [], rms: [], ultimo: null
    }));
    const porHora = Array.from({ length: 24 }, () => ({ travessias: 0, pessoas: 0, horas: 0, com_medicao: 0, medicoes: 0 }));
    let totalTravessias = 0, totalPessoas = 0, totalMedicoes = 0;

    for (let h = 0; h < nH; h++) {
      const trav = fluxoHora(p, h);
      const livres = janelasLivres(p, trav).slice(0, p.medicoes_max_por_hora);
      const ph = porHora[h % 24];
      ph.horas++; ph.travessias += trav.length;
      const pessoas = trav.reduce((s, c) => s + c.pesos.length, 0);
      ph.pessoas += pessoas;
      totalTravessias += trav.length; totalPessoas += pessoas;
      if (livres.length) ph.com_medicao++;
      ph.medicoes += livres.length; totalMedicoes += livres.length;

      for (const jan of livres) {
        const dia = (h + jan.t / 3600) / 24;
        let fatorF = fatorFrequencia(p, temp.estrutura[h], dia);
        fatorF *= 1 + p.repetibilidade * rng.normal();
        // a amplitude da vibração livre cresce com o peso de quem acabou de passar
        const fatorA = (jan.travessia.peso_total / p.fluxo.peso_medio_kg) * Math.exp(p.dispersao_amplitude * rng.normal());
        for (let j = 0; j < nS; j++) {
          const a = vibracaoLivre(p, p.sensores[j], fatorF, fatorA, rng);
          const esp = espectro(a, fs, p.aquisicao.f_max_hz);
          const pk = picoDominante(esp);
          const r = sens[j];
          r.dia.push(dia); r.temp.push(temp.medida[h]);
          r.f_real.push(p.modos[0].f_hz * fatorF);
          r.f_grade.push(pk.f_grade); r.f_interp.push(pk.f_interp);
          let q = 0;
          for (let i = 0; i < a.length; i++) q += a[i] * a[i];
          r.rms.push(Math.sqrt(q / a.length));
          r.ultimo = { sinal: a, esp };
        }
      }
    }

    // por sensor: médias diárias, critérios e indicadores
    for (const r of sens) {
      const fId = p.criterio.interpolacao ? r.f_interp : r.f_grade;
      const soma = Array.from({ length: p.dias }, () => ({ f: 0, t: 0, rms: 0, n: 0 }));
      r.dia.forEach((dia, i) => {
        const s = soma[Math.min(p.dias - 1, Math.floor(dia))];
        s.f += fId[i]; s.t += r.temp[i]; s.rms += r.rms[i]; s.n++;
      });
      const fDia = soma.map(s => s.n ? s.f / s.n : NaN), tDia = soma.map(s => s.n ? s.t / s.n : NaN);
      r.n_dia = soma.map(s => s.n);
      r.rms_dia = soma.map(s => s.n ? s.rms / s.n : NaN);
      // regressão f x T com as médias diárias da linha de base (o dia anula o atraso térmico)
      const ok = [];
      for (let d = 0; d < p.dias_baseline; d++) if (Number.isFinite(fDia[d])) ok.push(d);
      const reg = regressao(ok.map(d => tDia[d]), ok.map(d => fDia[d]));
      r.coef_temp = reg.a;
      r.f_ref = reg.a * p.temperatura.ref_c + reg.b;
      r.f_dia = fDia; r.t_dia = tDia;
      r.sem = classificar(p, fDia);
      r.com = classificar(p, fDia.map((f, d) => f - (reg.a * tDia[d] + reg.b)));
      r.f_corrigida = r.com.diario.map(v => r.f_ref + v);
      const erro = (est) => {
        let q = 0;
        for (let i = 0; i < est.length; i++) q += (est[i] - r.f_real[i]) ** 2;
        return Math.sqrt(q / Math.max(est.length, 1));
      };
      r.ind = {
        erro_grade_hz: erro(r.f_grade), erro_interp_hz: erro(r.f_interp),
        sem: indicadores(p, r.sem.estado), com: indicadores(p, r.com.estado)
      };
    }

    // último dia com medição de cada sensor, para o snapshot
    const ultimoDia = (r) => { for (let d = p.dias - 1; d >= 0; d--) if (r.n_dia[d]) return d; return p.dias - 1; };
    const pset = sens.map(r => {
      const d = ultimoDia(r);
      return {
        Sensor_ID: r.sensor_id, LastUpdate: `dia ${d + 1}`,
        LastDominantFrequency: +r.f_dia[d].toFixed(4), LastCorrectedFrequency: +r.f_corrigida[d].toFixed(4),
        LastRMS: +r.rms_dia[d].toFixed(6), LastStatus: r.com.estado[d], LastZ: +r.com.z[d].toFixed(2)
      };
    });
    const volume = {
      continuo_bytes: nS * fs * 86400 * 4,
      trechos_bytes: nS * (totalMedicoes / p.dias) * p.aquisicao.janela_s * fs * 4,
      snapshot_bytes: JSON.stringify(pset).length
    };
    const fluxo = {
      por_hora: porHora.map(x => ({
        travessias: x.travessias / x.horas, pessoas: x.pessoas / x.horas,
        horas_com_medicao: x.com_medicao / x.horas, medicoes: x.medicoes / x.horas
      })),
      travessias_dia: totalTravessias / p.dias, pessoas_dia: totalPessoas / p.dias, medicoes_dia: totalMedicoes / p.dias
    };

    const snapshot = {
      generated_at: `simulacao, dia ${p.dias}`,
      data_mode: 'simulacao',
      source_file: 'simulador (motor.js)',
      processing: {
        interval_s: [0, p.aquisicao.janela_s], remove_mean: true, window: 'Hamming',
        zero_padding: 'next_power_of_2', fft_range_hz: [0, p.aquisicao.f_max_hz]
      },
      sensors: sens.map(r => {
        const d = ultimoDia(r), u = r.ultimo;
        return {
          sensor_id: r.sensor_id, type: 'Accelerometer', channel: r.canal, location: r.posicao, unit: 'g',
          sampling_rate_hz: fs, mef_reference_hz: p.f_mef_hz,
          dominant_frequency_hz: +r.f_dia[d].toFixed(6),
          status_label: r.com.estado[d],
          status_message: `Simulação, dia ${d + 1}: frequência média do dia corrigida para ${p.temperatura.ref_c} °C ` +
            `${r.f_corrigida[d].toFixed(3)} Hz (${r.com.z[d] >= 0 ? '+' : ''}${r.com.z[d].toFixed(1)} σ em relação à linha de base).`,
          peaks: u ? picos(u.esp) : [],
          signal: {
            time_s: u ? Array.from(u.sinal, (_, i) => +(i / fs).toFixed(4)) : [],
            acceleration_g: u ? Array.from(u.sinal, v => +v.toFixed(8)) : []
          },
          fft: u ? { frequency_hz: Array.from(u.esp.f, v => +v.toFixed(6)), amplitude_g: Array.from(u.esp.amp, v => +v.toFixed(9)) }
            : { frequency_hz: [], amplitude_g: [] }
        };
      })
    };

    const res = { param: p, sensores: sens, temperatura_ar: temp.ar, pset, volume, fluxo, snapshot };
    res.semaforo_dia = semaforoDiario(res);
    const cD = res.semaforo_dia[p.dias - 1];
    res.pset_semaforo = {
      Semaforo_ID: 'SEM_CABECEIRAS', LastColor: CORES[cD.nivel], LastCause: cD.causa, LastUpdate: `dia ${p.dias}`
    };
    return res;
  }

  // Semáforo pela estrutura, dia a dia: estado diário com compensação do dia anterior (a média do dia
  // só fecha no fim do dia), o pior entre os sensores. ATENÇÃO -> AMARELO; ALERTA -> VERMELHO, que só
  // o gestor libera, depois da inspeção (no simulador, fica até o fim).
  function semaforoDiario(res) {
    const D = res.param.dias, saida = [{ nivel: 0, causa: '' }];
    let travado = null;
    for (let d = 1; d < D; d++) {
      let nivel = 0, causa = '';
      res.sensores.forEach(r => {
        const e = r.com.estado[d - 1], n = e === 'ALERTA' ? 2 : e === 'ATENÇÃO' ? 1 : 0;
        if (n > nivel) { nivel = n; causa = `${e} da frequência em ${r.sensor_id} (dia ${d})`; }
      });
      if (nivel === 2 && !travado) travado = causa;
      saida.push(travado ? { nivel: 2, causa: travado + '; aguarda inspeção' } : { nivel, causa });
    }
    return saida;
  }

  // ---------------------------------------------------------------------------
  // Ensaio virtual: resposta forçada pelos passos, numa hora escolhida
  // ---------------------------------------------------------------------------
  // Cada passo é um impulso proporcional ao peso e à forma do modo (sen(πx/L)) no ponto
  // pisado; a resposta de cada modo é a resposta impulsiva amortecida. A escala é ajustada
  // para que uma pessoa de peso médio produza pico_1_pessoa_g no meio do vão.
  function respostaPassos(p, travessias, dur, fsA, fatorF) {
    const nS = p.sensores.length, n = Math.ceil(dur * fsA), L = p.vao_m, F = p.fluxo;
    const a = p.sensores.map(() => new Float32Array(n));
    const modos = p.modos.map(m => {
      const w = 2 * Math.PI * m.f_hz * fatorF;
      return { w, wd: w * Math.sqrt(1 - m.amortecimento ** 2), z: m.amortecimento };
    });
    const nImp = Math.ceil(6 * fsA);   // 6 s de resposta por passo
    const imp = modos.map(m => {
      const v = new Float32Array(nImp);
      for (let i = 0; i < nImp; i++) { const t = i / fsA; v[i] = Math.exp(-m.z * m.w * t) * Math.sin(m.wd * t); }
      return v;
    });
    for (const c of travessias) {
      c.pesos.forEach((peso, k) => {
        const tIni = c.t0 + c.atrasos[k], dt = 1 / c.passo_hz;
        for (let t = tIni; ; t += dt) {
          const xr = c.v_ms * (t - tIni);
          if (xr > L) break;
          const forma = Math.sin(Math.PI * xr / L), i0 = Math.round(t * fsA);
          if (i0 >= n) break;
          for (let s = 0; s < nS; s++) {
            const amps = p.sensores[s].amplitudes_g;
            for (let j = 0; j < modos.length; j++) {
              const g = (peso / F.peso_medio_kg) * forma * amps[j], v = imp[j], dest = a[s];
              const lim = Math.min(nImp, n - i0);
              for (let i = 0; i < lim; i++) dest[i0 + i] += g * v[i];
            }
          }
        }
      });
    }
    return a;
  }

  let escalaCache = null;
  function escalaPassos(p) {
    const chave = JSON.stringify([p.modos, p.sensores[0].amplitudes_g, p.vao_m, p.fluxo]);
    if (escalaCache && escalaCache.chave === chave) return escalaCache.k;
    const F = p.fluxo, passo = (F.passo_hz[0] + F.passo_hz[1]) / 2, v = passo * F.comprimento_passo_m;
    const um = [{ t0: 0.5, pesos: [F.peso_medio_kg], passo_hz: passo, v_ms: v, sentido: 1, atrasos: [0] }];
    const a = respostaPassos(p, um, p.vao_m / v + 7, 200, 1)[0];
    let pico = 0;
    for (let i = 0; i < a.length; i++) pico = Math.max(pico, Math.abs(a[i]));
    const k = pico > 0 ? F.pico_1_pessoa_g / pico : 0;
    escalaCache = { chave, k };
    return k;
  }

  function classeSetra(aPicoG) {
    const ms2 = aPicoG * 9.81;
    if (ms2 <= 0.5) return 'conforto máximo';
    if (ms2 <= 1.0) return 'conforto médio';
    if (ms2 <= 2.5) return 'conforto mínimo';
    return 'desconforto';
  }

  // Resposta aos passos em escala (pico_1_pessoa_g) com ruído; pico no primeiro sensor (meio do vão).
  function aceleracoes(p, trav, dur, fsA, fatorF, semente) {
    const a = respostaPassos(p, trav, dur, fsA, fatorF), k = escalaPassos(p), rng = gerador(semente >>> 0);
    let pico = 0;
    a.forEach((v, s) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = v[i] * k + p.ruido_g * rng.normal();
        if (s === 0) pico = Math.max(pico, Math.abs(v[i]));
      }
    });
    return { a, pico };
  }

  // dia em base 0; hora de 0 a 23. fsA: amostras por segundo da animação.
  // opc.estrutura: nível do semáforo pela estrutura (0, 1, 2) no dia; opc.est: estado do semáforo
  // ao fim da hora anterior, para encadear horas.
  function ensaioVirtual(param, dia, hora, fsA = 100, opc = {}) {
    const p = prepararSensores(JSON.parse(JSON.stringify(param || PARAM_PADRAO)));
    const h = dia * 24 + hora, dur = 3600;
    const trav = fluxoHora(p, h);
    const temp = temperaturas(p, gerador(p.semente));
    const fatorF = fatorFrequencia(p, temp.estrutura[h], dia + hora / 24);
    const { a, pico } = aceleracoes(p, trav, dur, fsA, fatorF, p.semente * 31 + h);
    const janelas = janelasLivres(p, trav);
    const E = {
      param: p, dia, hora, fs: fsA, dur, aceleracao: a, travessias: trav,
      janelas_livres: janelas.map(j => j.t), medidas: janelas.slice(0, p.medicoes_max_por_hora).map(j => j.t),
      pessoas: trav.reduce((s, c) => s + c.pesos.length, 0),
      pico_g: pico, classe: classeSetra(pico),
      f1_hz: p.modos[0].f_hz * fatorF, temperatura_c: temp.ar[h]
    };
    aplicarSemaforo(E, { estrutura: opc.estrutura || 0, causa_estrutura: opc.causa_estrutura, est: opc.est, t0: hora * 3600 });
    return E;
  }

  // ---------------------------------------------------------------------------
  // Semáforo nas cabeceiras
  // ---------------------------------------------------------------------------
  const REGRAS = [
    { chave: 'pico', nome: 'pico de aceleração', un: 'm/s²', lim: S => S.pico_ms2 },
    { chave: 'ocupacao', nome: 'ocupação', un: 'pessoas/m²', lim: S => S.ocupacao_pm2 },
    { chave: 'chuva', nome: 'chuva', un: 'mm/h', lim: S => S.chuva_mmh },
    { chave: 'vento', nome: 'vento', un: 'm/s', lim: S => S.vento_ms },
    { chave: 'flecha', nome: 'flecha no meio do vão', un: 'mm', lim: (S, p) => limitesFlechaMm(p) }
  ];
  const ativo = v => v !== null && v !== undefined && v > 0;
  // Nível (0, 1, 2) de um valor frente aos limiares [AMARELO, VERMELHO], multiplicados por f.
  const nivelDe = (v, lim, f = 1) => (ativo(lim[1]) && v > lim[1] * f) ? 2 : (ativo(lim[0]) && v > lim[0] * f) ? 1 : 0;

  // Rigidez à flexão (N·m²) da viga equivalente: calibrada pela massa e pela frequência do primeiro
  // modo (viga biapoiada, f1 = (π/2)·√(EI/(m·L⁴))) ou, sem massa, a das longarinas.
  function rigidezEI(p) {
    const F = p.flecha;
    if (F.massa_kg_m > 0) return F.massa_kg_m * Math.pow(2 * p.modos[0].f_hz * p.vao_m * p.vao_m / Math.PI, 2);
    return F.E_pa * F.I_perfil_m4 * F.longarinas;
  }

  // Flecha (mm) no meio do vão pela soma das cargas: δ = P·a·(3L² − 4a²)/(48·EI), a = min(x, L − x).
  function flechaMeioMm(p, pessoas) {
    const L = p.vao_m, EI = rigidezEI(p);
    if (!(EI > 0) || !(L > 0)) return 0;
    let soma = 0;
    for (const q of pessoas) {
      const a = Math.min(Math.max(0, q.x), Math.max(0, L - q.x));
      soma += q.peso * 9.81 * a * (3 * L * L - 4 * a * a) / (48 * EI);
    }
    return soma * 1000;
  }

  // Limiares da flecha (mm): [AMARELO, VERMELHO] = [fração·L/n, L/n].
  function limitesFlechaMm(p) {
    const v = 1000 * p.vao_m / p.flecha.limite_razao;
    return [v * p.flecha.fracao_amarelo, v];
  }

  // Séries por segundo para o semáforo: pico de |a| nos sensores com dados, pessoas sobre a passarela,
  // flecha no meio do vão, sensores com dados. falhas: [{ j (índice do sensor; -1 = todos), t0, t1 }].
  function seriesPorSegundo(E, falhas = []) {
    const n = Math.floor(E.dur), fs = E.fs, ids = E.param.sensores.map(s => s.sensor_id);
    const falho = (j, t) => falhas.some(f => (f.j === -1 || f.j === j) && t >= f.t0 && t < f.t1);
    const pico = new Float64Array(n), sensor = new Array(n), ocup = new Float64Array(n), ok = new Uint8Array(n);
    const flecha = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let m = 0, js = -1, nOk = 0;
      E.aceleracao.forEach((a, j) => {
        if (falho(j, k)) return;
        nOk++;
        for (let i = k * fs; i < (k + 1) * fs && i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) { m = v; js = j; } }
      });
      pico[k] = m * 9.81; sensor[k] = js >= 0 ? ids[js] : ''; ok[k] = nOk;
      const pp = pessoasNoInstante(E, k + 0.5);
      ocup[k] = pp.length;
      flecha[k] = flechaMeioMm(E.param, pp);
    }
    return { pico_ms2: pico, sensor_pico: sensor, ocupacao: ocup, flecha_mm: flecha, sensores_ok: ok };
  }

  // Avalia o semáforo segundo a segundo. Cada regra sobe na hora e só desce depois de tempo_amarelo_s
  // (saindo do AMARELO) ou tempo_vermelho_s (saindo do VERMELHO) com o valor abaixo do limiar menos
  // a histerese. Estrutura (estado diário) e monitoramento indisponível (nenhum sensor com dados:
  // AMARELO) entram como regras. Com chuva ou vento em AMARELO (piso molhado, vento), o VERMELHO da
  // ocupação baixa para ocupacao_clima_pm2. O semáforo mostra a pior cor.
  function avaliarSemaforo(p, ent, est) {
    const S = p.semaforo, area = p.vao_m * p.largura_m, n = ent.pico_ms2.length, t0 = ent.t0 || 0;
    est = est || { nivel: {}, abaixo: {}, cor: null };
    const cor = new Uint8Array(n), registro = [];
    for (let k = 0; k < n; k++) {
      const t = t0 + k;
      const v = { pico: ent.pico_ms2[k], ocupacao: ent.ocupacao[k] / area,
        chuva: ent.chuva ? ent.chuva[k] : 0, vento: ent.vento ? ent.vento[k] : 0, flecha: ent.flecha_mm ? ent.flecha_mm[k] : 0 };
      let pior = ent.estrutura || 0;
      let causa = pior ? { nome: ent.causa_estrutura || 'estado diário da frequência', valor: '', limiar: '', un: '' } : null;
      if (ent.sensores_ok[k] === 0 && pior < 1) { pior = 1; causa = { nome: 'monitoramento indisponível', valor: '', limiar: '', un: '' }; }
      // com chuva ou vento em AMARELO (no segundo anterior), o VERMELHO da ocupação baixa para ocupacao_clima_pm2
      const clima = est.nivel.chuva ? 'chuva' : est.nivel.vento ? 'vento' : '';
      for (const r of REGRAS) {
        let lim = r.lim(S, p), nome = r.nome;
        if (r.chave === 'ocupacao' && clima && ativo(S.ocupacao_clima_pm2)) { lim = [lim[0], S.ocupacao_clima_pm2]; nome = `ocupação com ${clima}`; }
        const atual = est.nivel[r.chave] || 0;
        const sobe = nivelDe(v[r.chave], lim), desce = nivelDe(v[r.chave], lim, 1 - S.histerese);
        let nv = atual;
        if (sobe > atual) { nv = sobe; est.abaixo[r.chave] = null; }
        else if (desce < atual) {
          if (est.abaixo[r.chave] == null) est.abaixo[r.chave] = t;
          if (t - est.abaixo[r.chave] >= (atual === 2 ? S.tempo_vermelho_s : S.tempo_amarelo_s)) { nv = desce; est.abaixo[r.chave] = null; }
        } else est.abaixo[r.chave] = null;
        est.nivel[r.chave] = nv;
        if (nv > pior) { pior = nv; causa = { nome, valor: +v[r.chave].toFixed(2), limiar: lim[nv - 1], un: r.un, regra: r.chave }; }
      }
      if (pior !== est.cor && !(est.cor === null && pior === 0)) {
        registro.push({
          t_s: t, tipo: 'semáforo', de: est.cor === null ? '' : CORES[est.cor], para: CORES[pior],
          causa: causa ? causa.nome : 'valores abaixo dos limiares', valor: causa ? causa.valor : '',
          limiar: causa ? causa.limiar : '', unidade: causa ? causa.un : '',
          sensor_id: causa && causa.regra === 'pico' ? ent.sensor_pico[k] : '', pessoas: ent.ocupacao[k],
          aviso: pior === 2 ? 'gestor avisado' : ''
        });
      }
      est.cor = pior; cor[k] = pior;
    }
    return { cor, registro, est };
  }

  // Calcula o semáforo de um ensaio e os indicadores: tempo em cada cor, primeira vez em cada cor e
  // pessoas que entraram com VERMELHO (o semáforo as teria impedido; no simulador ninguém obedece).
  function aplicarSemaforo(E, opc = {}) {
    const ent = seriesPorSegundo(E, opc.falhas);
    Object.assign(ent, { chuva: opc.ambiente && opc.ambiente.chuva, vento: opc.ambiente && opc.ambiente.vento,
      estrutura: opc.estrutura || 0, causa_estrutura: opc.causa_estrutura, t0: opc.t0 || 0 });
    const r = avaliarSemaforo(E.param, ent, opc.est);
    const avisos = (opc.avisos || []).map(a => ({ t_s: (opc.t0 || 0) + a.t, tipo: 'aviso', de: '', para: '', causa: a.texto,
      valor: '', limiar: '', unidade: '', sensor_id: a.sensor_id || '', pessoas: ent.ocupacao[Math.min(a.t, ent.ocupacao.length - 1)], aviso: a.para }));
    const tempo = [0, 0, 0], primeiro = [null, null, null];
    r.cor.forEach((c, k) => { tempo[c]++; if (primeiro[c] === null) primeiro[c] = k; });
    let entradas = 0;
    E.travessias.forEach(c => c.pesos.forEach((_, k) => {
      const t = Math.floor(c.t0 + c.atrasos[k]);
      if (r.cor[t] === 2) entradas++;
    }));
    E.serie = ent;
    E.semaforo = { cor: r.cor, est: r.est, registro: r.registro.concat(avisos).sort((a, b) => a.t_s - b.t_s),
      tempo_s: tempo, primeiro_s: primeiro, entradas_vermelho: entradas, pior: tempo[2] ? 2 : tempo[1] ? 1 : 0 };
    E.ambiente = opc.ambiente || null;
    E.falhas = opc.falhas || [];
    E.t0_s = opc.t0 || 0;          // instante do registro correspondente a t = 0 do ensaio
    return E;
  }

  // Pedestres dos cenários "situações de alerta" e "chuva e vento" (os mesmos nos dois, cerca de 2 min):
  // grupos cada vez maiores. Até 8 pessoas, VERDE; 12 pessoas juntas passam de 0,5 pessoa/m² (AMARELO);
  // depois de o semáforo voltar ao VERDE, uma multidão, que sozinha também fica no AMARELO. Ritmos de
  // passo longe de 7,93/4 = 1,98 Hz, para não excitar o modo por ressonância.
  const CENAS_ALERTA = [
    { t0: 2, rotulo: 'uma pessoa', n: 1, passo_hz: 1.8, sentido: 1 },
    { t0: 14, rotulo: 'duas pessoas lado a lado', n: 2, passo_hz: 1.7, sentido: -1, fileira: 2 },
    { t0: 27, rotulo: 'grupo de oito pessoas, em fila', n: 8, passo_hz: 1.75, sentido: 1, fileira: 1 },
    { t0: 42, rotulo: 'grupo de doze pessoas, de três em três', n: 12, passo_hz: 1.75, sentido: -1, fileira: 3 }
  ];

  // Falha de sensor: um sensor para em 15 s, outro em 35 s e todos em 60 s (até o fim).
  const FALHA_S = [15, 35, 60];

  // Cenários hipotéticos para gerar alarmes: 'alerta' (situações de alerta), 'tempestade', 'falha' e
  // 'parada' (multidão parada).
  function ensaioCenario(param, nome, fsA = 100) {
    const p = prepararSensores(JSON.parse(JSON.stringify(param || PARAM_PADRAO))), F = p.fluxo, C = p.cenarios;
    const rng = gerador((p.semente * 13 + nome.charCodeAt(0)) >>> 0);
    const trav = [], opc = { avisos: [] };
    let dur, marco, titulo, parados = null;
    if (nome === 'alerta' || nome === 'tempestade' || nome === 'falha') {
      // mesmos pedestres nos dois cenários: sorteio próprio, que não depende do cenário
      const rp = gerador((p.semente * 13 + 500) >>> 0);
      const peso = () => Math.max(35, F.peso_medio_kg + F.peso_desvio_kg * rp.normal());
      let ns = 0;
      const semente = () => p.semente * 13 + 1000 + 7 * ns++;
      CENAS_ALERTA.forEach(c => trav.push(travessia(p, c.t0, Array.from({ length: c.n }, peso), c.passo_hz, c.sentido, semente(), c.rotulo, c.fileira || 1)));
      // multidão depois de o semáforo voltar ao VERDE: saída das 12 pessoas mais o tempo para sair do
      // AMARELO. Cada pessoa entra sozinha; numa multidão anda-se mais devagar (passo de 1,6 a 1,85 Hz).
      marco = Math.ceil(trav[trav.length - 1].fim + p.semaforo.tempo_amarelo_s + 5);
      for (let i = 0; i < C.multidao_pessoas; i++) {
        const t0 = i === 0 ? marco : marco + C.multidao_chegada_s * rp.u(), passo = 1.6 + 0.25 * rp.u();
        trav.push(travessia(p, t0, [peso()], passo, rp.u() < 0.5 ? 1 : -1, semente(),
          i === 0 ? `multidão: ${C.multidao_pessoas} pessoas em ${C.multidao_chegada_s} s` : undefined));
      }
      const saida = Math.max(...trav.map(c => c.fim));
      dur = Math.ceil(saida + p.semaforo.tempo_vermelho_s + 5);
      titulo = `situações de alerta: grupos cada vez maiores e, no fim, ${C.multidao_pessoas} pessoas em ${C.multidao_chegada_s} s`;
      if (nome === 'tempestade') {
        // mesmos pedestres, com chuva (sobe de 5 s a 30 s) e vento (de 30 s a 55 s, com rajadas) até a
        // multidão sair; sozinhos, chuva e vento dão AMARELO; com a passarela carregada, VERMELHO
        titulo = `os mesmos pedestres, com chuva até ${C.chuva_max_mmh} mm/h e vento até ${C.vento_max_ms} m/s`;
        marco = 5;
        const fim = saida, rampa = (u, a, b) => u < a ? 0 : u < b ? (u - a) / (b - a) : u < fim ? 1 : u < fim + 5 ? (fim + 5 - u) / 5 : 0;
        const chuva = new Float64Array(dur), vento = new Float64Array(dur);
        for (let k = 0; k < dur; k++) {
          chuva[k] = C.chuva_max_mmh * rampa(k, 5, 30);
          const rajada = Math.min(1.1, Math.max(0.9, 1 + 0.05 * rng.normal()));   // ±10% no máximo
          vento[k] = C.vento_max_ms * rampa(k, 30, 55) * rajada;
        }
        opc.ambiente = { chuva, vento };
      }
      if (nome === 'falha') {
        // mesmos pedestres; os sensores param um a um, do último ao primeiro (o do meio do vão é o último
        // a parar). Com um ou dois parados, a cor não muda e a manutenção é avisada; sem nenhum, AMARELO
        // até o fim.
        const [f1, f2, f3] = FALHA_S, n = p.sensores.length, ids = p.sensores.map(s => s.sensor_id);
        marco = f3; titulo = 'os mesmos pedestres; os sensores param um a um';
        opc.falhas = [];
        [f1, f2].forEach((t, i) => {
          const j = n - 1 - i;
          if (j < 1) return;
          opc.falhas.push({ j, t0: t, t1: dur });
          opc.avisos.push({ t, texto: `${ids[j]} sem dados`, sensor_id: ids[j], para: 'manutenção avisada' });
        });
        opc.falhas.push({ j: -1, t0: f3, t1: dur });
        opc.avisos.push({ t: f3, texto: 'todos os sensores sem dados', para: 'gestor avisado' });
      }
    } else if (nome === 'parada') {
      // multidão parada: as pessoas (peso médio) chegam uma a uma de 5 s a 20 s, ficam espalhadas pelo
      // vão em até lado_a_lado_max fileiras e saem de 40 s a 50 s. Sem passos, não há aceleração; a
      // ocupação acende o AMARELO e a flecha mostra a folga em relação a L/350.
      const n = Math.max(1, Math.round(C.parada_pessoas)), fil = Math.max(1, Math.round(F.lado_a_lado_max));
      const col = Math.ceil(n / fil), ordem = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng.u() * (i + 1)); [ordem[i], ordem[j]] = [ordem[j], ordem[i]]; }
      parados = ordem.map((k, i) => ({ x: (Math.floor(k / fil) + 0.5) * p.vao_m / col, faixa: k % fil, peso: F.peso_medio_kg,
        t0: 5 + 15 * i / n, t1: 40 + 10 * i / n }));
      dur = 50 + p.semaforo.tempo_amarelo_s + 10;
      marco = 20;
      titulo = `multidão parada: ${n} pessoas de ${F.peso_medio_kg} kg espalhadas pelo vão (${(n / (p.vao_m * p.largura_m)).toFixed(1)} por m²)`;
    } else throw new Error('cenário desconhecido: ' + nome);
    trav.sort((a, b) => a.t0 - b.t0);
    const { a, pico } = aceleracoes(p, trav, dur, fsA, 1, p.semente * 31 + 11);
    // sensor em falha não envia dados (aparece zerado na animação)
    (opc.falhas || []).forEach(f => a.forEach((v, j) => {
      if (f.j === -1 || f.j === j) for (let i = f.t0 * fsA; i < Math.min(v.length, f.t1 * fsA); i++) v[i] = 0;
    }));
    const E = {
      param: p, cenario: nome, titulo, marco_s: marco, dia: 0, hora: 0, fs: fsA, dur, aceleracao: a, travessias: trav,
      parados, janelas_livres: [], medidas: [], pessoas: parados ? parados.length : trav.length,
      pico_g: pico, classe: classeSetra(pico), f1_hz: p.modos[0].f_hz, temperatura_c: p.temperatura.ref_c
    };
    return aplicarSemaforo(E, opc);
  }

  // Ensaios de alarme E1 a E6. res: resultado de simular() com os mesmos parâmetros (E4 usa o
  // semáforo diário pela estrutura). Devolve uma linha por ensaio e o registro de todos.
  function ensaiosAlarme(param, res) {
    const p = param || PARAM_PADRAO, linhas = [], registro = [];
    const corTxt = c => CORES[c];
    const mmss = s => s === null ? '-' : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
    const juntar = (id, E) => E.semaforo.registro.forEach(r => registro.push(Object.assign({ ensaio: id }, r)));

    // E1: dia normal (dia 1), hora a hora, com o semáforo encadeado entre as horas
    let est = null;
    const tempo = [0, 0, 0], troca = [0, 0, 0];
    let entradas = 0;
    for (let h = 0; h < 24; h++) {
      const E = ensaioVirtual(p, 0, h, 100, { est });
      est = E.semaforo.est;
      E.semaforo.tempo_s.forEach((s, c) => tempo[c] += s);
      E.semaforo.registro.forEach(r => { if (r.tipo === 'semáforo') troca[CORES.indexOf(r.para)]++; });
      entradas += E.semaforo.entradas_vermelho;
      juntar('E1', E);
    }
    const pct = c => `${(100 * tempo[c] / 86400).toFixed(1)}%`;
    linhas.push({ id: 'E1', cenario: 'Dia normal (24 h, fluxo do dia 1)', esperado: 'VERDE',
      obtido: tempo[2] ? 'VERMELHO' : tempo[1] ? 'AMARELO' : 'VERDE',
      reacao: '-', detalhe: `VERDE ${pct(0)}, AMARELO ${pct(1)}, VERMELHO ${pct(2)} do dia; ` +
        `${troca[1]} vezes AMARELO e ${troca[2]} vezes VERMELHO; ${entradas} entradas com VERMELHO` });

    // E2, E3, E5: cenários hipotéticos
    const cen = (id, nome, esperado, txtReacao) => {
      const E = ensaioCenario(p, nome);
      juntar(id, E);
      linhas.push({ id, cenario: E.titulo, esperado, obtido: corTxt(E.semaforo.pior), reacao: txtReacao(E), detalhe: '' });
      return E;
    };
    // E2 e E3: os mesmos pedestres, sem e com chuva e vento. Pior cor em cada trecho: grupos de 1 a 8
    // pessoas, grupo de 12 e multidão.
    const area = p.vao_m * p.largura_m, g12 = CENAS_ALERTA[3].t0;
    const trechos = E => {
      const pior = (t0, t1) => corTxt(Math.max(...E.semaforo.cor.slice(t0, t1)));
      const mt = E.travessias.find(c => c.rotulo && c.rotulo.startsWith('multidão')).t0;
      return `${pior(0, g12)} até 8 pessoas; ${pior(g12, g12 + 20)} com 12; ${pior(Math.floor(mt), Math.floor(mt) + p.cenarios.multidao_chegada_s + 10)} com a multidão`;
    };
    const ocupMax = E => { let m = 0; E.serie.ocupacao.forEach(o => m = Math.max(m, o)); return m; };
    const E2 = cen('E2', 'alerta', 'VERDE até 8 pessoas; AMARELO com 12; AMARELO com a multidão', E => `AMARELO aos ${mmss(E.semaforo.primeiro_s[1])}`);
    linhas[linhas.length - 1].obtido = trechos(E2);
    linhas[linhas.length - 1].detalhe = `até ${ocupMax(E2)} pessoas sobre a passarela (${(ocupMax(E2) / area).toFixed(2)} por m²); ` +
      `pico de ${(E2.pico_g * 9.81).toFixed(2)} m/s²; nenhum VERMELHO`;
    const E3 = cen('E3', 'tempestade', 'AMARELO pela chuva; VERMELHO só com a multidão', E => {
      const a = E.semaforo.registro.find(r => r.para === 'AMARELO'), v = E.semaforo.registro.find(r => r.para === 'VERMELHO');
      return `AMARELO (${a ? a.causa : '-'}) aos ${a ? mmss(a.t_s) : '-'}; VERMELHO ${v ? `(${v.causa}) aos ${mmss(v.t_s)}` : 'não ocorreu'}`;
    });
    linhas[linhas.length - 1].obtido = trechos(E3);
    linhas[linhas.length - 1].detalhe = `os mesmos pedestres do E2; com chuva ou vento, o VERMELHO da ocupação baixa para ` +
      `${p.semaforo.ocupacao_clima_pm2} pessoa/m²; ${E3.semaforo.entradas_vermelho} entradas com VERMELHO`;

    // E4: perda de rigidez, pelo semáforo diário da simulação de 60 dias
    if (res) {
      const sd = res.semaforo_dia, ini = Math.floor(p.dano.inicio_dia), nb = p.dias_baseline;
      let am = null, vm = null, falsoAm = 0, falsoVm = 0;
      sd.forEach((c, d) => {
        if (d >= nb + 1 && d < ini) { if (c.nivel === 1) falsoAm++; if (c.nivel === 2) falsoVm++; }
        if (d >= ini) { if (am === null && c.nivel >= 1) am = d; if (vm === null && c.nivel === 2) vm = d; }
      });
      const dd = d => d === null ? 'não ocorreu' : `${d - ini} dias`;
      linhas.push({ id: 'E4', cenario: `Perda de rigidez de ${(100 * p.dano.perda_rigidez).toFixed(1)}% a partir do dia ${p.dano.inicio_dia}`,
        esperado: 'AMARELO e VERMELHO', obtido: corTxt(Math.max(...sd.slice(ini).map(c => c.nivel), 0)),
        reacao: `AMARELO ${dd(am)}, VERMELHO ${dd(vm)} após o início`,
        detalhe: `antes da perda: ${falsoAm} dias AMARELO e ${falsoVm} dias VERMELHO; o VERMELHO fica até o gestor liberar` });
      sd.forEach((c, d) => {
        if (d > 0 && c.nivel !== sd[d - 1].nivel) registro.push({ ensaio: 'E4', t_s: d * 86400, tipo: 'semáforo',
          de: CORES[sd[d - 1].nivel], para: CORES[c.nivel], causa: c.causa || 'estado diário NORMAL', valor: '', limiar: '',
          unidade: '', sensor_id: '', pessoas: '', aviso: c.nivel === 2 ? 'gestor avisado' : '' });
      });
    }

    // E5: mesmos pedestres; até o grupo de 12, só passam grupos que ficam no VERDE
    const E5 = cen('E5', 'falha', 'VERDE com um e com dois sensores parados; AMARELO sem nenhum sensor', E =>
      Math.min(...E.semaforo.cor.slice(FALHA_S[2])) >= 1 ? `AMARELO desde a perda do último sensor (${mmss(FALHA_S[2])}) até o fim` : 'o AMARELO não se manteve');
    const cor = E5.semaforo.cor, [f1, f2, f3] = FALHA_S;
    linhas[linhas.length - 1].obtido = `${corTxt(Math.max(...cor.slice(f1, f2)))} com um sensor parado; ${corTxt(Math.max(...cor.slice(f2, g12)))} com dois; ` +
      `${corTxt(Math.min(...cor.slice(f3)))} sem nenhum, até o fim`;
    linhas[linhas.length - 1].detalhe = 'sensor parado: manutenção avisada; todos parados: gestor avisado';

    // E6: multidão parada; a flecha fica abaixo do AMARELO (folga em relação a L/350)
    const E6 = cen('E6', 'parada', 'AMARELO pela ocupação; flecha abaixo do AMARELO', E => `AMARELO aos ${mmss(E.semaforo.primeiro_s[1])}`);
    const fMax = Math.max(...E6.serie.flecha_mm), [fA, fV] = limitesFlechaMm(E6.param);
    const causas = [...new Set(E6.semaforo.registro.filter(r => r.tipo === 'semáforo' && r.para !== 'VERDE').map(r => `${r.para} (${r.causa})`))];
    linhas[linhas.length - 1].obtido = causas.join('; ') || 'VERDE';
    linhas[linhas.length - 1].detalhe = `flecha máxima de ${fMax.toFixed(1)} mm (${(100 * fMax / fV).toFixed(0)}% de L/${E6.param.flecha.limite_razao}; ` +
      `AMARELO em ${fA.toFixed(1)} mm, VERMELHO em ${fV.toFixed(1)} mm); EI = ${(rigidezEI(E6.param) / 1e6).toFixed(0)} MN·m²`;
    linhas.sort((a, b) => a.id.localeCompare(b.id));
    return { linhas, registro };
  }

  // CSV do registro de alarmes dos ensaios
  function csvAlarmes(ens) {
    const hms = s => s === '' ? '' : [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
    const linhas = ['ensaio;instante;tipo;de;para;causa;valor;limiar;unidade;sensor_id;pessoas;aviso'];
    ens.registro.forEach(r => linhas.push([r.ensaio, r.ensaio === 'E4' ? `dia ${r.t_s / 86400 + 1}` : hms(r.t_s), r.tipo, r.de, r.para,
      r.causa, r.valor, r.limiar, r.unidade, r.sensor_id, r.pessoas, r.aviso].join(';')));
    return linhas.join('\n') + '\n';
  }

  // Demonstração: sequência curta de grupos típicos, para quem vê a animação pela primeira vez.
  // Uso normal, sem alertas: no máximo quatro pessoas ao mesmo tempo (grupos maiores ficam nos cenários
  // de alerta). Cada cena termina com a passarela vazia por uma janela de medição (vibração livre).
  const CENAS_DEMO = [
    { t0: 2, rotulo: 'uma pessoa', pesos: [70], passo_hz: 1.8, sentido: 1 },
    { t0: 17, rotulo: 'um casal devagar e uma pessoa apressada que o ultrapassa', pesos: [62, 84], passo_hz: 1.7, sentido: 1, fileira: 2 },
    { t0: 18, rotulo: null, pesos: [78], passo_hz: 2.2, sentido: 1 },
    { t0: 35, rotulo: 'três pessoas lado a lado', pesos: [71, 58, 77], passo_hz: 1.75, sentido: -1, fileira: 3 },
    { t0: 53, rotulo: 'quatro pessoas lado a lado', pesos: [68, 74, 59, 81], passo_hz: 1.85, sentido: 1, fileira: 4 },
    { t0: 70, rotulo: 'sentidos opostos: uma pessoa rápida e outra devagar', pesos: [75], passo_hz: 2.2, sentido: 1 },
    { t0: 71, rotulo: null, pesos: [66], passo_hz: 1.65, sentido: -1 }
  ];

  function ensaioDemo(param, fsA = 100) {
    const p = prepararSensores(JSON.parse(JSON.stringify(param || PARAM_PADRAO)));
    const trav = CENAS_DEMO.map((c, i) => travessia(p, c.t0, c.pesos.slice(), c.passo_hz, c.sentido,
      p.semente * 31 + 100 + i, c.rotulo, c.fileira || 1));
    const dur = Math.ceil(trav[trav.length - 1].fim + 10);
    const { a, pico } = aceleracoes(p, trav, dur, fsA, 1, p.semente * 31 + 7);
    const janelas = janelasLivres(p, trav).filter(j => j.t + p.aquisicao.janela_s <= dur);
    return aplicarSemaforo({
      param: p, demo: true, dia: 0, hora: 0, fs: fsA, dur, aceleracao: a, travessias: trav,
      janelas_livres: janelas.map(j => j.t), medidas: janelas.map(j => j.t),
      pessoas: trav.reduce((s, c) => s + c.pesos.length, 0),
      pico_g: pico, classe: classeSetra(pico), f1_hz: p.modos[0].f_hz, temperatura_c: p.temperatura.ref_c
    });
  }

  // Posição (m, desde o apoio esquerdo) de cada pessoa sobre a passarela no instante t.
  function pessoasNoInstante(ens, t) {
    const L = ens.param.vao_m, saida = [];
    ens.travessias.forEach((c, ic) => {
      if (t < c.t0 || t > c.fim) return;
      c.pesos.forEach((peso, k) => {
        const xr = c.v_ms * (t - c.t0 - c.atrasos[k]);
        if (xr < 0 || xr > L) return;
        saida.push({ x: c.sentido > 0 ? xr : L - xr, peso, grupo: ic, passo: c.passo_hz, sentido: c.sentido, faixa: c.faixas[k] });
      });
    });
    // pessoas paradas (cenário de multidão parada): sem passo, um grupo à parte
    (ens.parados || []).forEach(q => {
      if (t >= q.t0 && t < q.t1) saida.push({ x: q.x, peso: q.peso, grupo: ens.travessias.length, passo: 0, sentido: 0, faixa: q.faixa, parado: true });
    });
    return saida;
  }

  // CSV de eventos (uma medição por linha e sensor)
  function csvEventos(res) {
    const linhas = ['dia;sensor_id;temp_ar_medida_c;f_real_hz;f_grade_hz;f_interp_hz;rms_g'];
    for (const r of res.sensores) {
      for (let i = 0; i < r.dia.length; i++) {
        linhas.push([r.dia[i].toFixed(4), r.sensor_id, r.temp[i].toFixed(3), r.f_real[i].toFixed(6),
          r.f_grade[i].toFixed(6), r.f_interp[i].toFixed(6), r.rms[i].toFixed(7)].join(';'));
      }
    }
    return linhas.join('\n') + '\n';
  }

  return {
    PARAM_PADRAO, ESTADOS, CORES, gerador, fft, espectro, picoDominante, picos, perdaRigidez, prepararSensores,
    fluxoHora, janelasLivres, simular, ensaioVirtual, ensaioDemo, ensaioCenario, pessoasNoInstante, classeSetra,
    rigidezEI, flechaMeioMm, limitesFlechaMm, avaliarSemaforo, ensaiosAlarme, csvEventos, csvAlarmes
  };
});
