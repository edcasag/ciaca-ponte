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
    aquisicao: { fs_hz: 1000, janela_s: 4.1, f_max_hz: 50 },
    medicoes_max_por_hora: 1,     // trechos de vibração livre analisados por hora
    // calibrados pelo ensaio (trecho de vibração livre de 402,4 a 406,5 s)
    modos: [
      { f_hz: 7.93457, amortecimento: 0.01468 },
      { f_hz: 9.765625, amortecimento: 0.01066 }
    ],
    sensores: [
      { sensor_id: 'ACC_MV_01', canal: 'A1272_18A', posicao: 'Meio do vão', amplitudes_g: [0.04988, 0.01969] },
      { sensor_id: 'ACC_QV_01', canal: 'A1274_18A', posicao: '1/4 do vão', amplitudes_g: [0.02930, 0.01155] },
      { sensor_id: 'ACC_AP_01', canal: 'A1275_18A', posicao: 'Apoio', amplitudes_g: [0.00121, 0.00051] }
    ],
    f_mef_hz: 6.91394,
    fluxo: {
      // travessias por hora, de 0 h a 23 h (picos de manhã, no almoço e no fim da tarde)
      travessias_por_hora: [0, 0, 0, 0, 0, 1, 4, 25, 40, 15, 10, 12, 30, 35, 12, 10, 12, 25, 40, 20, 8, 5, 2, 1],
      grupo_extra_fora_pico: 0.3,  // média de pessoas além da primeira (Poisson), fora de pico
      grupo_extra_pico: 2.0,       // idem, na hora de maior fluxo
      peso_medio_kg: 70, peso_desvio_kg: 12,
      passo_hz: [1.6, 2.2], comprimento_passo_m: 0.7,
      intervalo_grupo_s: 0.6,      // distância, em tempo, entre pessoas do mesmo grupo
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
    criterio: { k_atencao: 2, k_alerta: 3, persistencia_dias: 2, interpolacao: true }
  };

  const ESTADOS = ['BASELINE', 'NORMAL', 'ATENÇÃO', 'ALERTA'];

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
      const v = passo * F.comprimento_passo_m;
      const t0 = 3600 * rng.u();
      const duracao = p.vao_m / v + (pessoas - 1) * F.intervalo_grupo_s;
      lista.push({ t0, fim: t0 + duracao, pesos, peso_total: pesos.reduce((s, x) => s + x, 0),
        passo_hz: passo, v_ms: v, sentido: rng.u() < 0.5 ? 1 : -1 });
    }
    return lista.sort((a, b) => a.t0 - b.t0);
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
    const p = JSON.parse(JSON.stringify(param || PARAM_PADRAO));
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

    return { param: p, sensores: sens, temperatura_ar: temp.ar, pset, volume, fluxo, snapshot };
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
        const tIni = c.t0 + k * F.intervalo_grupo_s, dt = 1 / c.passo_hz;
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
    const um = [{ t0: 0.5, pesos: [F.peso_medio_kg], passo_hz: passo, v_ms: v, sentido: 1 }];
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

  // dia em base 0; hora de 0 a 23. fsA: amostras por segundo da animação.
  function ensaioVirtual(param, dia, hora, fsA = 100) {
    const p = JSON.parse(JSON.stringify(param || PARAM_PADRAO));
    const h = dia * 24 + hora, dur = 3600;
    const trav = fluxoHora(p, h);
    const temp = temperaturas(p, gerador(p.semente));
    const fatorF = fatorFrequencia(p, temp.estrutura[h], dia + hora / 24);
    const k = escalaPassos(p);
    const a = respostaPassos(p, trav, dur, fsA, fatorF);
    const rng = gerador((p.semente * 31 + h) >>> 0);
    let pico = 0;
    a.forEach((v, s) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = v[i] * k + p.ruido_g * rng.normal();
        if (s === 0) pico = Math.max(pico, Math.abs(v[i]));
      }
    });
    const janelas = janelasLivres(p, trav);
    return {
      param: p, dia, hora, fs: fsA, dur, aceleracao: a, travessias: trav,
      janelas_livres: janelas.map(j => j.t), medidas: janelas.slice(0, p.medicoes_max_por_hora).map(j => j.t),
      pessoas: trav.reduce((s, c) => s + c.pesos.length, 0),
      pico_g: pico, classe: classeSetra(pico),
      f1_hz: p.modos[0].f_hz * fatorF, temperatura_c: temp.ar[h]
    };
  }

  // Demonstração: sequência curta de grupos típicos, para quem vê a animação pela primeira vez.
  const CENAS_DEMO = [
    { t0: 2, rotulo: 'uma pessoa', pesos: [70], passo_hz: 1.8, sentido: 1 },
    { t0: 21, rotulo: 'duas pessoas juntas', pesos: [62, 84], passo_hz: 1.7, sentido: -1 },
    { t0: 40, rotulo: 'duas pessoas em sentidos opostos', pesos: [75], passo_hz: 1.9, sentido: 1 },
    { t0: 41, rotulo: null, pesos: [66], passo_hz: 1.8, sentido: -1 },
    { t0: 60, rotulo: 'grupo de quatro pessoas', pesos: [68, 74, 59, 81], passo_hz: 2.0, sentido: 1 },
    { t0: 82, rotulo: 'grupo grande, como no horário de pico', pesos: [72, 65, 80, 58, 77, 69, 90, 63], passo_hz: 1.9, sentido: -1 }
  ];

  function ensaioDemo(param, fsA = 100) {
    const p = JSON.parse(JSON.stringify(param || PARAM_PADRAO)), F = p.fluxo;
    const trav = CENAS_DEMO.map(c => {
      const v = c.passo_hz * F.comprimento_passo_m;
      const fim = c.t0 + p.vao_m / v + (c.pesos.length - 1) * F.intervalo_grupo_s;
      return { t0: c.t0, fim, pesos: c.pesos.slice(), peso_total: c.pesos.reduce((s, x) => s + x, 0),
        passo_hz: c.passo_hz, v_ms: v, sentido: c.sentido, rotulo: c.rotulo };
    });
    const dur = Math.ceil(trav[trav.length - 1].fim + 10);
    const a = respostaPassos(p, trav, dur, fsA, 1), k = escalaPassos(p), rng = gerador((p.semente * 31 + 7) >>> 0);
    let pico = 0;
    a.forEach((v, s) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = v[i] * k + p.ruido_g * rng.normal();
        if (s === 0) pico = Math.max(pico, Math.abs(v[i]));
      }
    });
    const janelas = janelasLivres(p, trav).filter(j => j.t + p.aquisicao.janela_s <= dur);
    return {
      param: p, demo: true, dia: 0, hora: 0, fs: fsA, dur, aceleracao: a, travessias: trav,
      janelas_livres: janelas.map(j => j.t), medidas: janelas.map(j => j.t),
      pessoas: trav.reduce((s, c) => s + c.pesos.length, 0),
      pico_g: pico, classe: classeSetra(pico), f1_hz: p.modos[0].f_hz, temperatura_c: p.temperatura.ref_c
    };
  }

  // Posição (m, desde o apoio esquerdo) de cada pessoa sobre a passarela no instante t.
  function pessoasNoInstante(ens, t) {
    const L = ens.param.vao_m, F = ens.param.fluxo, saida = [];
    ens.travessias.forEach((c, ic) => {
      if (t < c.t0 || t > c.fim) return;
      c.pesos.forEach((peso, k) => {
        const xr = c.v_ms * (t - c.t0 - k * F.intervalo_grupo_s);
        if (xr < 0 || xr > L) return;
        saida.push({ x: c.sentido > 0 ? xr : L - xr, peso, grupo: ic, passo: c.passo_hz, sentido: c.sentido });
      });
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
    PARAM_PADRAO, ESTADOS, gerador, fft, espectro, picoDominante, picos, perdaRigidez,
    fluxoHora, janelasLivres, simular, ensaioVirtual, ensaioDemo, pessoasNoInstante, classeSetra, csvEventos
  };
});
