# Esempio JSON con i video

Premi **Prova file di esempio**: vengono caricati 35 soggetti sintetici e associati automaticamente i tre video. Il pulsante sostituisce il dataset corrente, seleziona AWI/arancia e ripristina la visualizzazione senza normalizzazione o limiti temporali. Funziona anche aprendo direttamente `index.html`, senza server.

In alternativa puoi caricare `metrics_demo_2_stimoli.json` usando **Scegli file JSON**; in questo caso associa i video manualmente come descritto sotto.

Il dataset contiene 35 soggetti sintetici (`DEMO_01`–`DEMO_35`), due epoche di stimolo e 8 metriche originali: AWI, BAR, BATR, CI, FTA, MI, WL e WPI. Deriva dal file `EEG_TimeSeries_demo_sintetico_2_stimoli.xlsx` presente nella stessa cartella: tutti i 57.680 valori e i tempi originali sono preservati. Sono aggiunte una baseline sintetica di 10 secondi e due nuove metriche a 60 Hz, per un totale di 3 epoche e 10 metriche. Non sono misure EEG reali.

## Associazione dei video

Per il caricamento manuale del JSON, apri **Time series → Associa video alle epoche** e scegli i file presenti nella cartella:

| Epoca nel JSON | Video | Durata |
| --- | --- | --- |
| `stim_arancia_` | `video_demo_stim_arancia.mp4` | 22,5 s |
| `stim_cocacola` | `video_demo_stim_cocacola.mp4` | 80,5 s |
| `baseline` | `video_demo_baseline.mp4` (nero, senza audio) | 10 s |

Lo zero temporale coincide con l'inizio del video. Le 8 metriche originali hanno campioni distanziati di 0,5 s e iniziano a 0,5 s, come nell'Excel. Il nome `stim_arancia_` mantiene il trattino basso finale del foglio originale.

Se importi manualmente il JSON, l'associazione va fatta nel pannello video: il JSON documenta gli abbinamenti in `demo_info.videos`, ma non carica automaticamente i file locali. Dopo averli associati, cambiando epoca cambia anche il video.

## Provare i segmenti significativi

1. Seleziona tutti i soggetti e la metrica **AWI**.
2. Usa **Nessuna · valori originali** come normalizzazione. La baseline è disponibile, ma per riprodurre questi risultati lascia disattivata la normalizzazione.
3. Lascia vuoti i limiti temporali e il passo griglia.
4. In **Analisi statistiche**, scegli **Un campione · confronto con valore nullo**, valore nullo **0**, **5.000** permutazioni e seed **12345**.
5. Seleziona l'epoca **stim_arancia_** e premi **Esegui analisi**. Nella sezione **Momenti significativi nel video** puoi riprodurre i segmenti e scaricare clip o frame.

Con queste impostazioni, la verifica restituisce per AWI/arancia quattro intervalli: **0,5–1,5 s**, **2,5–3 s**, **4–19 s**, **20–22 s** (41 istanti significativi su 45). Per AWI/Coca-Cola non risultano istanti significativi su 161: è possibile verificare anche la gestione di questo caso. I dati non sono stati modificati per forzare la significatività.

Il filtro usa il p-value finale corretto, con soglia 0,05. I risultati sono dimostrativi e cambiano se modifichi soggetti o impostazioni. Le clip conservano l'audio solo se presente nel video originale.


## Baseline e metriche a 60 Hz

`baseline` contiene 10 secondi di dati sintetici per tutte le metriche. Viene preselezionata come epoca di riferimento: apri le opzioni di normalizzazione e scegli z-score, z-MAD oppure variazione percentuale per usarla. Il video associato è nero, 1280×720, 30 fps, senza audio e dura esattamente 10 secondi; il frame rate del video è indipendente dalla frequenza delle metriche.

`AWI_60Hz` e `WL_60Hz` sono nuove serie sintetiche, non versioni interpolate delle metriche originali. Sono disponibili in entrambi gli stimoli e nella baseline: passo 1/60 s (tempi memorizzati con 9 decimali), primo campione a 1/60 s e ultimo alla durata dell'epoca. La baseline contiene 600 campioni, arancia 1.350 e Coca-Cola 4.830 per metrica e soggetto. Il generatore riproducibile è `scripts/generate_demo_additions.py` (seed 20261116); non modifica le otto metriche originali degli stimoli né il file Excel.

Per provarle, premi **Prova file di esempio**, scegli una metrica con suffisso `_60Hz` e lascia vuoto il passo griglia. Per le analisi statistiche dell'intero video Coca-Cola a 60 Hz usa 1.000 permutazioni, oppure restringi l'intervallo temporale: 5.000 permutazioni sull'intera serie superano il limite di calcolo dell'app.
