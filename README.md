# Monitoramento contínuo de uma passarela: indicadores por sensor para o modelo IFC

Simulador virtual do monitoramento contínuo de uma passarela metálica de pedestres. Pessoas atravessam ao longo do dia, com picos de fluxo. Depois de cada travessia, com a passarela vazia, o trecho de vibração livre é identificado pela FFT. Por dia, cada sensor (`Sensor_ID`) recebe um estado: BASELINE, NORMAL, ATENÇÃO ou ALERTA. Os indicadores resumidos formam um *snapshot* para um conjunto de propriedades (Pset) do sensor no modelo IFC, e as séries temporais ficam no banco de dados.

Um semáforo nas cabeceiras (VERDE, AMARELO, VERMELHO) é acionado por limiares de aceleração, ocupação, chuva, vento, flecha no meio do vão e pelo estado diário da estrutura. Cenários hipotéticos (situações de alerta, chuva e vento, falha de sensor, multidão parada) servem para gerar alarmes, que ficam registrados.

A passarela, o fluxo de pessoas, os acelerômetros, a temperatura, a chuva, o vento e uma perda de rigidez são simulados. Não há conexão com a estrutura real. É um trabalho em andamento: os resultados são um estudo de casos, a ser aprofundado com dados reais.

**Pergunta:** os indicadores que vão para o IFC distinguem uma perda de rigidez da variação causada pela temperatura?

## Como executar

Abra `index.html` no navegador. Não é preciso servidor nem instalação.

1. **Parâmetros:** edite os valores, inclusive o perfil de travessias por hora, os limiares do semáforo e os cenários de alarme, e clique em Simular. Os 60 dias levam alguns segundos. Na tabela de sensores, é possível acrescentar acelerômetros em qualquer posição do vão.
2. **Resultados:**
   - figura com temperatura, frequência dominante e estado diário pelos dois critérios;
   - figura com o fluxo e as medições por hora do dia;
   - indicadores por sensor e volume de dados.

   As duas figuras podem ser baixadas em PNG, em tons de cinza.
3. **Painel do gêmeo:** estado do semáforo e de cada `Sensor_ID` no último dia com medição, o *snapshot* para o IFC e os arquivos para baixar.
4. **Ensaio virtual:** abre com uma demonstração de uso normal, de cerca de 1,5 min a 1×, sem alertas: uma pessoa; um casal devagar ultrapassado por uma pessoa apressada; três e quatro lado a lado; duas em sentidos opostos, uma rápida e outra devagar. No cenário "Hora do dia", anima uma hora escolhida, com as mesmas travessias do monitoramento; as velocidades de 5×, 20× e 60× ajudam a percorrer a hora. Os cenários hipotéticos (situações de alerta, chuva e vento, falha de sensor) acionam os alarmes; cada um dura cerca de 2 min. A multidão parada (cerca de 1 min) põe 110 pessoas paradas sobre o vão. Ao chegar ao fim, a animação recomeça. Mostra as pessoas atravessando, o tabuleiro vibrando (deformação ampliada) e o semáforo das duas cabeceiras. Sob o tabuleiro, um anúncio informa quantas pessoas estão atravessando e o peso total; com a passarela vazia, informa o próximo grupo (pessoas, peso, lado de entrada) e o tempo até ele chegar. Embaixo, a vibração aparece parada, como uma corda de violão: a faixa mostra a oscilação no último 0,5 s e, sob cada sensor, a barra indica a oscilação atual e os traços o máximo desde o início, com os limites do Sétra. Abaixo do quadro, três gráficos mostram, segundo a segundo, a aceleração máxima, a flecha no meio do vão e a ocupação, com os limiares do semáforo tracejados e uma linha que acompanha a animação; podem ser baixados em PNG, em tons de cinza. Depois vem o registro de alarmes do ensaio. O botão "Rodar ensaios" executa os ensaios E1 a E6 e permite baixar o registro de todos.

`testes.html` roda os testes automáticos do motor.

## Calibração

Modos, amortecimento e amplitudes por sensor vêm do trecho de vibração livre de um ensaio real (três acelerômetros, 1.000 Hz, de 402,4 a 406,5 s). O vão de 11,95 m vem do comprimento das vigas no modelo IFC.

| Sensor_ID | Canal | Posição | Amplitude a 7,93 Hz (g) | Amplitude a 9,77 Hz (g) |
|---|---|---|---:|---:|
| ACC_MV_01 | A1272_18A | Meio do vão | 0,04988 | 0,01969 |
| ACC_QV_01 | A1274_18A | 1/4 do vão | 0,02930 | 0,01155 |
| ACC_AP_01 | A1275_18A | Apoio | 0,00121 | 0,00051 |

- **Amortecimento** (estimado pela envoltória de cada modo): 1,47% a 7,93 Hz e 1,07% a 9,77 Hz.
- **Modelo numérico de referência:** 6,914 Hz.
- **Largura útil:** 1,70 m, da chapa de piso no modelo IFC (`Qto_SlabBaseQuantities`); área útil de 20,3 m².
- **Rigidez à flexão (EI):** calibrada pela massa do modelo IFC e pela frequência do ensaio. O IFC parcial soma 0,389 m³ de aço (`NetVolume`), cerca de 3,05 t, ou 255 kg/m no vão de 11,95 m (a confirmar). Para uma viga biapoiada, f1 = (π/2)·√(EI/(m·L⁴)); com f1 = 7,93 Hz, EI = m·(2·f1·L²/π)² ≈ 133 MN·m². Só as duas longarinas do modelo numérico (altura de 330 mm, mesas de 160 × 11 mm, alma de 7,5 mm; I = 1,0785 × 10⁻⁴ m⁴ cada; E = 210 GPa) dão 45,3 MN·m²; com esse valor, a frequência medida exigiria apenas 87 kg/m.

**N sensores.** Um acelerômetro acrescentado recebe a amplitude do meio do vão multiplicada por sen(πx/L)/sen(π/2), em que x é a distância ao apoio. A forma do 2º modo não foi medida, e usa-se a mesma. A aproximação é grosseira: a 1/4 do vão, a fórmula dá 71% do meio do vão, e o ensaio mediu 59%.

## Modelo

**Fluxo de pessoas**
- Travessias por hora sorteadas (Poisson) a partir de um perfil diário. O padrão tem a madrugada vazia e picos às 8 h, às 13 h e às 18 h. Somam cerca de 310 travessias e 745 pessoas por dia.
- O grupo tem uma pessoa mais um número de extras (Poisson). A média de extras é de 0,3 fora de pico e chega a 2 na hora de maior fluxo.
- O peso de cada pessoa é sorteado em torno de 70 kg (desvio de 12 kg). O passo, de 1,6 a 2,2 Hz, é o mesmo para todo o grupo. A passada de 0,7 m varia ±15% entre grupos, o que dá velocidades diferentes.
- O grupo anda em fileiras de 2 a 4 pessoas lado a lado (a largura de 1,70 m permite 4), uma fileira a cada 0,6 s. Na mesma fileira, cada pessoa tem um atraso próprio de até 0,3 s.

**Medição**
- Vale o trecho logo após uma travessia, desde que ninguém entre na passarela por uma janela inteira (4,1 s).
- Por padrão, analisa-se no máximo um trecho por hora.
- De madrugada não há travessia, logo não há medição. Com fluxo muito alto, também pode faltar trecho livre.

**Vibração livre**
- A amplitude cresce com o peso total do grupo que acabou de passar, com dispersão log-normal de 0,25.
- O ruído do acelerômetro é de 0,3 mg.

**Temperatura**
- O ar tem ciclo diário de ±6 °C, oscilação de ±1,5 °C a cada 9 dias e aquecimento de 4 °C no período, em torno de 22 °C.
- A estrutura acompanha o ar com 2 h de atraso, e o termômetro tem erro de 0,5 °C.
- Na frequência, o efeito é de −0,1% por °C (Moser e Moaveni, 2011), mais 0,05% de variação entre medições.

**Perda de rigidez**
- 1% em rampa do dia 40 ao 50. A frequência é proporcional à raiz da rigidez, então cai cerca de 0,5%.

**Ensaio virtual (animação)**
- Cada passo é um impulso proporcional ao peso e à forma do modo, sen(πx/L), no ponto pisado. A resposta de cada sensor é a soma das respostas impulsivas amortecidas dos dois modos.
- A escala é ajustada para que uma pessoa de peso médio produza 0,08 g no meio do vão. Esse valor é estimado e deve ser calibrado pelo registro do ensaio.
- As pessoas de um grupo andam no mesmo ritmo de passo. Quem está na mesma fileira pisa quase no mesmo ponto e ao mesmo tempo, e os impulsos se somam: oito pessoas aos pares dão mais aceleração que oito em fila. Isso tende a superestimar o pico em grupos grandes.
- Como cada passo é um impulso, o modelo dá a todos os harmônicos do passo o mesmo peso; na marcha real, o 4º harmônico é muito pequeno. Passos perto de 7,93/4 = 1,98 Hz podem, por isso, superestimar a aceleração. Com 7,93 Hz, a passarela está fora da faixa de risco de ressonância vertical do Sétra (acima de 5 Hz).

**Flecha no meio do vão**
- Viga biapoiada equivalente, com o EI da calibração. Cada pessoa sobre a passarela é uma carga concentrada na sua posição x, e a flecha no meio do vão é a soma δ = Σ P·a·(3L² − 4a²)/(48·EI), com a = min(x, L − x). Com uma pessoa de 70 kg no meio do vão, δ = PL³/(48·EI).
- Cálculo estático: não inclui peso próprio, amplificação dinâmica nem a distribuição tridimensional da rigidez. A flecha é calculada, não medida; o sensor de deslocamento (ultrassônico) é só previsto.

## Identificação

Segue o mesmo método do ensaio:
1. Remoção da média.
2. Janela de Hamming.
3. *Zero-padding* até a próxima potência de 2.
4. FFT de 0 a 50 Hz.
5. Maior pico acima de 1 Hz.

Extensão opcional: interpolação parabólica do pico. Com 4,1 s de sinal, a grade da FFT tem 0,12 Hz, enquanto o efeito da temperatura é de cerca de 8 mHz por °C. Sem a interpolação, a variação diária fica abaixo da resolução.

## Critério de estado

| Estado | Condição |
|---|---|
| BASELINE | primeiros 14 dias: aprende a média e o desvio (σ) das médias diárias |
| NORMAL | média diária dentro de ±2σ |
| ATENÇÃO | média diária fora de ±2σ |
| ALERTA | fora de ±3σ em dois dias seguidos (persistência) |

Um dia sem medição repete o estado anterior.

Os dois critérios usam a mesma simulação:

- **sem compensação:** média diária da frequência;
- **com compensação:** resíduo da regressão entre frequência e temperatura, ajustada com as médias diárias da linha de base.

## Semáforo

O semáforo das duas cabeceiras mostra a pior cor entre as regras. Os limiares são parâmetros e valores de referência, a confirmar com o grupo de estruturas. Pedestres sozinhos acendem no máximo o AMARELO, em caso de abuso; o VERMELHO vem do vento forte, da ocupação com chuva ou vento e da estrutura.

| Regra | AMARELO | VERMELHO |
|---|---|---|
| Pico de aceleração, por segundo, nos sensores com dados (limite de desconforto do Sétra) | > 2,5 m/s² | - |
| Ocupação (densidade de referência do Sétra) | > 0,5 pessoa/m² | só com chuva ou vento em AMARELO: > 0,75 pessoa/m² (hipotético) |
| Chuva (hipotético) | > 10 mm/h | - |
| Vento (hipotético) | > 15 m/s | > 20 m/s |
| Estado diário da frequência, com compensação, do dia anterior | ATENÇÃO | ALERTA |
| Flecha no meio do vão (L/350 da NBR 8800, vigas de piso de edificações, por analogia) | > 0,8·L/350 = 27,3 mm | > L/350 = 34,1 mm |
| Nenhum sensor com dados | sempre | - |

- **Subida e descida:** a cor sobe na hora. Só desce quando o valor fica 10% abaixo do limiar (histerese) por 10 s, saindo do AMARELO, ou 20 s, saindo do VERMELHO.
- **VERMELHO por dano:** fica até o gestor liberar, depois da inspeção. No simulador, fica até o fim.
- **Falha de sensores:** um ou dois sensores parados não mudam a cor; a manutenção é avisada. Sem nenhum sensor com dados, AMARELO enquanto durar a falha (o contador de pessoas continua valendo).
- **Pedestres:** no simulador, não obedecem ao VERMELHO. As entradas nesse estado são contadas, porque são as que o semáforo teria impedido.

## Cenários hipotéticos e ensaios de alarme

| Ensaio | Cenário |
|---|---|
| E1 | Dia normal: as 24 horas do dia 1, com o semáforo encadeado entre as horas |
| E2 | Situações de alerta (2 min): uma pessoa, duas lado a lado, oito em fila (VERDE), doze de três em três (AMARELO); o semáforo volta ao VERDE; uma multidão de 25 pessoas em 15 s (AMARELO). Só com pedestres, nunca VERMELHO |
| E3 | Chuva e vento (2 min): os mesmos pedestres do E2; a chuva sobe até 30 mm/h (AMARELO), depois o vento até 18 m/s, com rajadas de até ±10% (AMARELO). Com chuva ou vento, o VERMELHO da ocupação baixa para 0,75 pessoa/m², e a multidão acende o VERMELHO |
| E4 | Perda de rigidez: semáforo diário da simulação de 60 dias |
| E5 | Falha de sensor (2 min): os mesmos pedestres do E2; um sensor para aos 15 s, outro aos 35 s e todos aos 60 s, até o fim |
| E6 | Multidão parada (cerca de 1 min): 110 pessoas de 70 kg chegam de 5 s a 20 s, ficam espalhadas pelo vão em até quatro fileiras (5,4 por m²) e saem de 40 s a 50 s. Sem passos, sem aceleração; a ocupação acende o AMARELO e a flecha mostra a folga em relação a L/350 |

## Resultados com os parâmetros padrão (semente 2026)

| Sensor_ID | Erro de f, grade (mHz) | Erro de f, interpolação (mHz) | Sem compensação: ATENÇÃO / ALERTA falsos | Sem compensação: detecção | Com compensação: ATENÇÃO / ALERTA falsos | Com compensação: detecção |
|---|---:|---:|---:|---:|---:|---:|
| ACC_MV_01 | 36,9 | 1,4 | 4 / 2 | 6 dias | 2 / 0 | 3 dias |
| ACC_QV_01 | 36,9 | 1,4 | 4 / 2 | 6 dias | 2 / 0 | 3 dias |
| ACC_AP_01 | 37,2 | 4,2 | 5 / 0 | 6 dias | 1 / 0 | 3 dias |

- **Falsos:** dias em ATENÇÃO ou ALERTA antes da perda de rigidez.
- **Detecção:** dias do início da perda de rigidez até o fim do primeiro dia em ALERTA.
- **Medições:** 18 por dia; nenhuma da 0 h às 4 h.
- **Efeito da temperatura estimado:** −7,2 mHz/°C, contra −7,9 mHz/°C simulados. Como as medições se concentram no período do dia, a média diária ainda carrega parte do atraso térmico.

### Ensaios de alarme (parâmetros padrão)

| Ensaio | Esperado | Obtido | Reação |
|---|---|---|---|
| E1 Dia normal | VERDE; AMARELO raro | VERDE 99,7% do dia, AMARELO 0,3% (16 vezes, 15 pelo pico e 1 pela ocupação); nenhum VERMELHO | - |
| E2 Situações de alerta | VERDE até 8 pessoas; AMARELO com 12 e com a multidão | igual ao esperado; até 19 pessoas (0,94 por m²); pico de 2,40 m/s²; nenhum VERMELHO | AMARELO aos 44 s |
| E3 Chuva e vento | AMARELO pela chuva; VERMELHO só com a multidão | igual ao esperado; 9 entradas com VERMELHO | AMARELO aos 14 s; VERMELHO aos 79 s |
| E4 Perda de rigidez | AMARELO e VERMELHO | AMARELO e VERMELHO; antes da perda, 2 dias em AMARELO | 2 e 3 dias após o início |
| E5 Falha de sensor | VERDE com um e com dois sensores parados; AMARELO sem nenhum | igual ao esperado | AMARELO dos 60 s até o fim |
| E6 Multidão parada | AMARELO pela ocupação; flecha abaixo do AMARELO | igual ao esperado; flecha máxima de 12,9 mm (38% de L/350), com EI de 133 MN·m² | AMARELO aos 6 s |

No E6, com o EI só das longarinas (massa de 0 kg/m nos parâmetros), a mesma multidão daria 37,7 mm e acenderia o VERMELHO pela flecha aos 18 s. É esse caso que o teste automático usa para verificar o VERMELHO da flecha.

No E1, os AMARELOS do dia normal vêm de grupos lado a lado com passo perto de 2 Hz, cujo 4º harmônico coincide com o modo de 7,93 Hz. Com o pico de uma pessoa estimado (0,08 g) e o grupo no mesmo ritmo de passo, o modelo pode superestimar a aceleração. Com o AMARELO do pico em 1,0 m/s² (fim do conforto médio do Sétra), o dia normal tinha 113 AMARELOS; por isso o padrão passou a 2,5 m/s². O registro do ensaio real, com passagens de uma, duas e três pessoas, deve calibrar a excitação antes de se fixarem os limiares.

| Dado por dia (3 sensores) | Volume | Onde fica |
|---|---:|---|
| Série contínua a 1.000 Hz | 1,04 GB | não armazenada |
| Trechos de vibração livre medidos | 0,89 MB | banco de dados |
| *Snapshot* (frequência, RMS e estado por `Sensor_ID`) | cerca de 500 bytes | modelo IFC (Pset) |

## Saídas

- **PNG das figuras,** em tons de cinza, para publicação, inclusive os gráficos de aceleração, flecha e ocupação do ensaio virtual.
- **`snapshot_ifc.json`:** por `Sensor_ID`: `LastDominantFrequency`, `LastCorrectedFrequency`, `LastRMS`, `LastStatus`, `LastZ` e `LastUpdate`; e o semáforo: `LastColor`, `LastCause` e `LastUpdate`.
- **`alarmes.csv`:** registro dos ensaios E1 a E6: instante, tipo (troca de cor ou aviso), cor, causa, valor, limiar, `Sensor_ID`, pessoas sobre a passarela e aviso (gestor ou manutenção).
- **`sensors.json`:** segue o formato da plataforma Web da passarela (visualizador IFC com painel do sensor). Copiado para a pasta `data/` da plataforma, mostra o estado simulado de cada sensor, com o sinal, o espectro e os picos da última medição.
- **`eventos.csv`:** uma medição por linha e sensor, com dia, temperatura medida, frequência simulada, frequência na grade, frequência interpolada e RMS.
- **`parametros.json`:** os parâmetros usados.

## Uso do motor

`motor.js` não tem dependências. Funciona no navegador (`window.Motor`) e em CommonJS:

```js
const r = Motor.simular(Motor.PARAM_PADRAO);
r.sensores[0].ind.com.atraso_dias;   // dias até o ALERTA, com compensação
r.fluxo.por_hora;                    // travessias, pessoas e medições por hora do dia
r.pset;                              // snapshot para o IFC
r.snapshot;                          // sensors.json da plataforma
const e = Motor.ensaioVirtual(Motor.PARAM_PADRAO, 0, 8);   // dia 1, 8 h
Motor.pessoasNoInstante(e, 120);     // posição de cada pessoa aos 120 s
Motor.ensaioDemo(Motor.PARAM_PADRAO);  // demonstração com grupos típicos (106 s)
Motor.ensaioCenario(Motor.PARAM_PADRAO, 'alerta');     // ou 'tempestade', 'falha', 'parada'; e.semaforo.registro, e.serie
Motor.ensaiosAlarme(Motor.PARAM_PADRAO, r);            // E1 a E6: { linhas, registro }
Motor.rigidezEI(Motor.PARAM_PADRAO);                   // EI da viga equivalente (N·m²)
Motor.flechaMeioMm(Motor.PARAM_PADRAO, [{ x: 5.975, peso: 70 }]);   // flecha no meio do vão (mm)
```

`passarela_padrao.json` é uma cópia de `Motor.PARAM_PADRAO`.

## Referências

Associação Brasileira de Normas Técnicas. (2024). *ABNT NBR 8800:2024: Projeto de estruturas de aço e de estruturas mistas de aço e concreto de edificações* (Anexo B, Tabela B.1). ABNT.

Moser, P., & Moaveni, B. (2011). Environmental effects on the identified natural frequencies of the Dowling Hall Footbridge. *Mechanical Systems and Signal Processing, 25*(7), 2336-2357. https://doi.org/10.1016/j.ymssp.2011.03.005
