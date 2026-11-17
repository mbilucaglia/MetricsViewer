(function (global) {
  'use strict';

  const webRVersion = '0.6.1';
  const webRUrl = 'https://webr.r-wasm.org/v' + webRVersion + '/webr.mjs';
  let session;

  function getRuntime(onStatus = () => {}) {
    if (!session) {
      const current = { onStatus, phase: 'Download di webR…', started: Date.now(), ready: false };
      onStatus(current.phase);
      session = current;
      current.promise = (async () => {
        try {
          const { WebR, ChannelType } = await import(webRUrl);
          if (session !== current) throw new DOMException('Analisi annullata.', 'AbortError');
          current.phase = 'Avvio del runtime R…';
          current.onStatus(current.phase);
          current.runtime = new WebR({ channelType: ChannelType.PostMessage });
          let reading = false, lastSecond = -1;
          current.timer = setInterval(async () => {
            if (session !== current || reading) return;
            if (!current.ready) {
              const seconds = Math.floor((Date.now() - current.started) / 1000);
              if (seconds !== lastSecond) {
                lastSecond = seconds;
                current.onStatus(current.phase + ' · ' + seconds + ' s');
              }
            }
            if (current.ready && !current.onProgress) return;
            reading = true;
            try {
              for (const message of await current.runtime.flush()) {
                if (message.type !== 'stdout') continue;
                const match = /^METRICS_PROGRESS\|([^|]+)\|(\d+)\|(\d+)/.exec(String(message.data).trim());
                if (match) current.onProgress?.(Number(match[2]), Number(match[3]), match[1]);
              }
            } catch { /* Closing a cancelled worker also closes its output queue. */ }
            finally { reading = false; }
          }, 150);
          await current.runtime.init();
          current.phase = 'Download e installazione di permuco…';
          current.onStatus(current.phase);
          await current.runtime.installPackages(['permuco']);
          current.phase = 'Verifica del pacchetto permuco…';
          current.onStatus(current.phase);
          if (!await current.runtime.evalRBoolean('requireNamespace("permuco", quietly = TRUE)')) {
            throw new Error('Pacchetto permuco non disponibile.');
          }
          current.ready = true;
          return current.runtime;
        } catch (error) {
          if (session !== current) throw error;
          resetRuntime();
          throw new Error('Impossibile caricare webR e permuco. Verifica la connessione e riprova.', { cause: error });
        }
      })();
    }
    session.onStatus = onStatus;
    if (!session.ready) onStatus(session.phase);
    return session.promise;
  }

  function resetRuntime() {
    const current = session;
    session = null;
    clearInterval(current?.timer);
    current?.runtime?.close();
  }

  const analysis = String.raw`
local({
  N <- as.integer(n)
  K <- as.integer(k)
  Y <- matrix(as.numeric(unlist(measurements)), nrow = N, ncol = K, byrow = TRUE)
  group <- factor(as.integer(unlist(membership)))
  within <- mode == "within"
  one <- mode != "multi"
  summaries <- lapply(levels(group), function(level) {
    values <- Y[group == level, , drop = FALSE]
    size <- nrow(values)
    sd <- apply(values, 2L, stats::sd)
    list(mean = colMeans(values), sd = sd, margin = sd * stats::qt(0.975, size - 1L) / sqrt(size))
  })
  pair_count <- if (within) choose(K, 2L) else if (post_hoc) choose(nlevels(group), 2L) else 0L
  pair_tests <- if (within) pair_count else pair_count * K
  M <- if (within) pair_tests else K
  # Bound work before fitting all contrasts or allocating their permutation matrix.
  if (pair_count && N * (K + pair_tests) * requested > 300000000) {
    stop("Troppi confronti: riduci epoche, gruppi o permutazioni.")
  }
  pairs <- if (pair_count) utils::combn(if (within) K else nlevels(group), 2L) else matrix(integer(), nrow = 2L)
  type <- if (one) "signflip" else "permutation"
  set.seed(as.integer(seed %% 2^31), kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
  if (seed >= 2^31) invisible(stats::runif(1L))
  P <- suppressWarnings(permuco::Pmat(n = N, np = requested + 1L, type = type))
  extra_columns <- if (correction == "cluster") sum(as.integer(unlist(gaps))) else 0L
  width <- if (within) M else K + pair_tests
  if (ncol(P) * (width + extra_columns) > 5000000) {
    stop("Analisi troppo estesa per webR. Riduci permutazioni o campioni.")
  }
  X <- if (one) matrix(1, N, 1L) else stats::model.matrix(~ 0 + group)
  g <- ncol(X)
  differences <- if (within) Y[, pairs[1L, ], drop = FALSE] - Y[, pairs[2L, ], drop = FALSE] else NULL
  Z <- if (within) differences else if (one) Y - null_value else sweep(Y, 2L, colMeans(Y), "-")
  if (any(!is.finite(Z))) stop("Valori troppo grandi per calcolare le permutazioni.")
  scales <- apply(abs(Z), 2L, max)
  Z <- sweep(Z, 2L, ifelse(scales == 0, 1, scales), "/")
  tolerance <- (64 * .Machine$double.eps)^2 * colSums(Z^2)
  student <- function(numerator, denominator, regular) {
    value <- numeric(length(numerator))
    value[regular] <- numerator[regular] / denominator[regular]
    separated <- !regular & numerator != 0
    value[separated] <- sign(numerator[separated]) * Inf
    value
  }
  group_rows <- split(seq_len(N), group)
  sizes <- lengths(group_rows)
  pair_statistics <- function(response) {
    moments <- lapply(group_rows, function(rows) {
      values <- response[rows, , drop = FALSE]
      mean <- colMeans(values)
      list(mean = mean, residual = colSums(sweep(values, 2L, mean, "-")^2))
    })
    as.numeric(vapply(seq_len(pair_count), function(i) {
      a <- pairs[1L, i]
      b <- pairs[2L, i]
      diff <- moments[[a]]$mean - moments[[b]]$mean
      residual <- moments[[a]]$residual + moments[[b]]$residual
      se <- sqrt(residual / (sizes[a] + sizes[b] - 2L) * (1 / sizes[a] + 1 / sizes[b]))
      student(diff, se, residual > (64 * .Machine$double.eps * diff)^2)
    }, numeric(K)))
  }
  statistic <- function(response) {
    fit <- stats::lm.fit(X, response)
    residual <- colSums(matrix(fit$residuals, nrow = N)^2)
    denominator <- residual / (N - g)
    if (one) {
      numerator <- as.numeric(fit$coefficients)
      denominator <- sqrt(denominator / N)
    } else {
      numerator <- colSums(matrix(fit$fitted.values, nrow = N)^2) / (g - 1L)
    }
    value <- student(numerator, denominator, residual > tolerance)
    if (post_hoc) c(value, pair_statistics(response)) else value
  }
  progress("Permutazioni", 0L, ncol(P) - 1L)
  D <- t(vapply(seq_len(ncol(P)), function(i) {
    transformed <- if (one) Z * as.numeric(P[, i]) else Z[as.integer(P[, i]), , drop = FALSE]
    value <- statistic(transformed)
    if (i %% 50L == 0L || i == ncol(P)) progress("Permutazioni", i - 1L, ncol(P) - 1L)
    value
  }, numeric(width)))
  # vapply drops the test dimension for a single column.
  if (width == 1L) D <- matrix(D, ncol = 1L)
  max_test <- function(distribution, two_sided) {
    adjusted <- permuco::compute_maxT(distribution, if (two_sided) "two.sided" else "greater")$main[, "pvalue"]
    compare <- round(if (two_sided) abs(distribution) else distribution, 10)
    list(statistic = distribution[1L, ],
         raw = colMeans(sweep(compare, 2L, compare[1L, ], ">=")), adjusted = adjusted)
  }
  observed <- D[1L, seq_len(M)]
  raw <- adjusted <- start <- end <- direction <- mass <- cluster_p <- cluster_peak <- numeric()
  pair_results <- list(statistic = numeric(), raw = numeric(), adjusted = numeric())
  empty_contrast <- list(estimate = numeric(), se = numeric(), low = numeric(), high = numeric(), d = numeric())
  contrast <- function(estimate, sd, multiplier, df) {
    se <- sd * multiplier
    margin <- stats::qt(.975, df) * se
    list(estimate = estimate, se = se, low = estimate - margin, high = estimate + margin,
         d = ifelse(sd > 0, estimate / sd, NA_real_))
  }
  eta <- function(f, df1, df2) ifelse(is.infinite(f), 1, f / (f + df2 / df1))
  pair_report <- one_report <- empty_contrast
  omnibus <- ms_effect <- ms_error <- effect_eta <- numeric()
  threshold <- numeric()
  if (within) {
    pair_results <- max_test(D, TRUE)
    pair_report <- contrast(colMeans(differences), apply(differences, 2L, stats::sd), 1 / sqrt(N), N - 1L)
    if (K > 2L) {
      # Remove subject effects. Since each row is shuffled only within subject,
      # its mean remains zero under every omnibus permutation.
      centered <- sweep(Y, 1L, rowMeans(Y), "-")
      if (any(!is.finite(centered))) stop("Valori troppo grandi per calcolare le permutazioni.")
      scale <- max(abs(centered))
      if (scale > 0) centered <- centered / scale
      sums_of_squares <- function(response) {
        means <- colMeans(response)
        c(effect = N * sum((means - mean(means))^2), error = sum(sweep(response, 2L, means, "-")^2))
      }
      repeated_f <- function(response, ss = sums_of_squares(response)) {
        student(ss[1L], ss[2L] / (N - 1L), ss[2L] > (64 * .Machine$double.eps)^2 * sum(response^2))
      }
      ss <- sums_of_squares(centered)
      ms_effect <- ss[1L] / (K - 1L) * scale^2
      ms_error <- ss[2L] / ((N - 1L) * (K - 1L)) * scale^2
      f <- repeated_f(centered, ss)
      effect_eta <- eta(f, K - 1L, (N - 1L) * (K - 1L))
      progress("Omnibus a misure ripetute", 0L, requested)
      shuffled_f <- vapply(seq_len(requested), function(i) {
        order <- vapply(seq_len(N), function(j) sample.int(K), integer(K))
        shuffled <- matrix(centered[seq_len(N) + N * (as.numeric(order) - 1L)],
                           nrow = N, ncol = K, byrow = TRUE)
        value <- repeated_f(shuffled)
        if (i %% 50L == 0L || i == requested) progress("Omnibus a misure ripetute", i, requested)
        value
      }, numeric(1L))
      omnibus <- c(f, (1 + sum(round(shuffled_f, 10) >= round(f, 10))) / (requested + 1L))
    }
  } else if (correction == "maxT") {
    main <- max_test(D[, seq_len(K), drop = FALSE], one)
    raw <- main$raw
    adjusted <- main$adjusted
    if (one) {
      one_report <- contrast(summaries[[1L]]$mean - null_value, summaries[[1L]]$sd, 1 / sqrt(N), N - 1L)
    } else {
      grand_mean <- colMeans(Y)
      ms_effect <- Reduce("+", lapply(seq_len(g), function(i) sizes[i] * (summaries[[i]]$mean - grand_mean)^2)) / (g - 1L)
      ms_error <- Reduce("+", lapply(seq_len(g), function(i) (sizes[i] - 1L) * summaries[[i]]$sd^2)) / (N - g)
      effect_eta <- eta(observed, g - 1L, N - g)
      if (post_hoc) {
        pair_results <- max_test(D[, K + seq_len(pair_tests), drop = FALSE], TRUE)
        reports <- lapply(seq_len(pair_count), function(i) {
          a <- pairs[1L, i]
          b <- pairs[2L, i]
          df <- sizes[a] + sizes[b] - 2L
          pooled <- sqrt(((sizes[a] - 1L) * summaries[[a]]$sd^2 + (sizes[b] - 1L) * summaries[[b]]$sd^2) / df)
          contrast(summaries[[a]]$mean - summaries[[b]]$mean, pooled, sqrt(1 / sizes[a] + 1 / sizes[b]), df)
        })
        pair_report <- lapply(names(empty_contrast), function(key) unlist(lapply(reports, "[[", key)))
        names(pair_report) <- names(empty_contrast)
      }
    }
  } else {
    threshold <- if (one) stats::qt(.975, N - 1L) else stats::qf(.95, g - 1L, N - g)
    if (any(if (one) abs(observed) > threshold else observed > threshold)) {
      positions <- seq_len(K) + cumsum(as.integer(unlist(gaps)))
      expanded <- matrix(0, nrow = nrow(D), ncol = max(positions))
      expanded[, positions] <- D
      mass_fun <- if (one) function(x) sum(x^2) else sum
      positive <- permuco::compute_clustermass(expanded, threshold, mass_fun, "greater")
      negative <- if (one) permuco::compute_clustermass(-expanded, threshold, mass_fun, "greater") else NULL
      maxima <- if (one) pmax(positive$distribution, negative$distribution) else positive$distribution
      for (side in if (one) c(1L, -1L) else 0L) {
        fit <- if (side < 0L) negative else positive
        ids <- fit$main[positions, "cluster_id"]
        for (id in unique(ids[ids > 0])) {
          members <- which(ids == id)
          value <- fit$main[positions[members[1L]], "statistic"]
          start <- c(start, members[1L])
          end <- c(end, tail(members, 1L))
          cluster_peak <- c(cluster_peak, members[which.max(abs(observed[members]))])
          direction <- c(direction, side)
          mass <- c(mass, value)
          cluster_p <- c(cluster_p, mean(round(maxima, 10) >= round(value, 10)))
        }
      }
      order <- order(start)
      start <- start[order]; end <- end[order]; direction <- direction[order]
      mass <- mass[order]; cluster_p <- cluster_p[order]; cluster_peak <- cluster_peak[order]
    }
  }
  list(statistic = observed, raw = raw, adjusted = adjusted,
       start = start, end = end, direction = direction, mass = mass, cluster_p = cluster_p, cluster_peak = cluster_peak,
       mean = unlist(lapply(summaries, function(item) item$mean)),
       margin = unlist(lapply(summaries, function(item) item$margin)), resamples = nrow(D),
       omnibus = omnibus, pair_a = pairs[1L, ], pair_b = pairs[2L, ], sizes = sizes,
       pair_statistic = pair_results$statistic, pair_raw = pair_results$raw,
       pair_adjusted = pair_results$adjusted, pair_report = pair_report, one_report = one_report,
       ms_effect = ms_effect, ms_error = ms_error, eta = effect_eta, threshold = threshold,
       sd = unlist(lapply(summaries, function(item) item$sd)),
       software = c(R.version.string, as.character(utils::packageVersion("permuco"))))
})
`;


  const progressCode = String.raw`
progress <- function(phase, done, total) {
  cat(paste("METRICS_PROGRESS", phase, done, total, sep = "|"), "\n")
  flush.console()
}
`;

  const mixedAnalysis = String.raw`
local({
  N <- as.integer(n)
  K <- as.integer(k)
  Y <- matrix(as.numeric(unlist(measurements)), nrow = N, ncol = K, byrow = TRUE)
  group <- factor(as.integer(unlist(membership)))
  G <- nlevels(group)
  sizes <- as.integer(table(group))
  if (K < 2L || G < 2L || any(sizes < 2L) || any(!is.finite(Y))) {
    stop("Servono almeno due gruppi con due soggetti completi e almeno due epoche ripetute.")
  }
  tests <- G * choose(K, 2L) + choose(G, 2L) * K
  if (N * K * (requested + 1L) > 5000000 || tests * N * requested > 300000000) {
    stop("Disegno misto troppo esteso. Riduci epoche, gruppi o permutazioni.")
  }
  set.seed(as.integer(seed %% 2^31), kind = "Mersenne-Twister", normal.kind = "Inversion", sample.kind = "Rejection")
  if (seed >= 2^31) invisible(stats::runif(1L))
  input <- data.frame(value = as.numeric(t(Y)), subject = factor(rep(seq_len(N), each = K)),
                      group = factor(rep(group, each = K)), epoch = factor(rep(seq_len(K), N)))
  P <- suppressWarnings(permuco::Pmat(n = N * K, np = requested + 1L, type = "permutation"))
  Pcols <- ncol(P)
  saved_table <- NULL
  distribution <- NULL
  warnings <- character()
  if (length(unique(sizes)) > 1L) {
    warnings <- "Gruppi sbilanciati: i p-value omnibus di permuco sono approssimati."
  }
  # Retain one shared permutation matrix. Each block includes identity so the
  # observed statistic remains the first row in permuco's output.
  first <- 2L
  while (first <= Pcols) {
    last <- min(Pcols, first + 99L)
    block <- P[, c(1L, seq.int(first, last)), drop = FALSE]
    attr(block, "type") <- "permutation"
    fit <- suppressWarnings(permuco::aovperm(value ~ group * epoch + Error(subject/epoch),
      data = input, P = block, method = "Rd_kheradPajouh_renaud"))
    if (is.null(saved_table)) {
      saved_table <- fit$table
      distribution <- fit$distribution
    } else {
      distribution <- rbind(distribution, fit$distribution[-1L, , drop = FALSE])
    }
    progress("ANOVA mista", last - 1L, Pcols - 1L)
    first <- last + 1L
  }
  effects <- c("group", "epoch", "group:epoch")
  table <- saved_table[effects, , drop = FALSE]
  dist <- round(distribution[, effects, drop = FALSE], 10)
  if (any(!is.finite(table[, "F"]))) stop("ANOVA non stimabile: varianza residua nulla o disegno singolare.")
  p <- colMeans(sweep(dist, 2L, dist[1L, ], ">="))
  summaries <- lapply(levels(group), function(level) {
    values <- Y[group == level, , drop = FALSE]
    size <- nrow(values)
    sd <- apply(values, 2L, stats::sd)
    list(mean = colMeans(values), sd = sd, margin = sd * stats::qt(.975, size - 1L) / sqrt(size))
  })
  t_value <- function(mean, se) ifelse(se > 0, mean / se, ifelse(mean == 0, 0, sign(mean) * Inf))
  rows <- list()
  add <- function(type, a, b, j, l, values, distribution, na, nb = 0L) {
    mean <- if (type == "paired") mean(values) else mean(values[[1L]]) - mean(values[[2L]])
    df <- if (type == "paired") na - 1L else na + nb - 2L
    sd <- if (type == "paired") stats::sd(values) else
      sqrt(((na - 1L) * stats::var(values[[1L]]) + (nb - 1L) * stats::var(values[[2L]])) / df)
    se <- sd * if (type == "paired") 1 / sqrt(na) else sqrt(1 / na + 1 / nb)
    stat <- t_value(mean, se)
    raw <- mean(round(abs(distribution), 10) >= round(abs(stat), 10))
    margin <- stats::qt(.975, df) * se
    rows[[length(rows) + 1L]] <<- c(type = type, a = a, b = b, j = j, l = l,
      nA = na, nB = nb, df = df, mean = mean, se = se, low = mean - margin, high = mean + margin,
      d = ifelse(sd > 0, mean / sd, NA_real_), statistic = stat, p = raw, resamples = length(distribution))
  }
  completed <- 0L
  posthoc_progress <- function(i, total) {
    if (i %% 100L == 0L || i == total) {
      progress(paste("Permutazioni post-hoc", completed + 1L, "/", tests), i - 1L, total - 1L)
    }
  }
  epoch_pairs <- utils::combn(K, 2L)
  for (g in seq_len(G)) {
    values <- Y[group == levels(group)[g], , drop = FALSE]
    signs <- suppressWarnings(permuco::Pmat(n = sizes[g], np = requested + 1L, type = "signflip"))
    for (pair in seq_len(ncol(epoch_pairs))) {
      j <- epoch_pairs[1L, pair]; l <- epoch_pairs[2L, pair]
      difference <- values[, j] - values[, l]
      stats <- vapply(seq_len(ncol(signs)), function(i) {
        x <- difference * signs[, i]
        value <- t_value(mean(x), stats::sd(x) / sqrt(length(x)))
        posthoc_progress(i, ncol(signs))
        value
      }, numeric(1L))
      add("paired", g, g, j, l, difference, stats, sizes[g])
      completed <- completed + 1L
      progress("Post-hoc", completed, tests)
    }
  }
  group_pairs <- utils::combn(G, 2L)
  for (pair in seq_len(ncol(group_pairs))) {
    a <- group_pairs[1L, pair]; b <- group_pairs[2L, pair]
    subset <- Y[group %in% levels(group)[c(a, b)], , drop = FALSE]
    labels <- group[group %in% levels(group)[c(a, b)]]
    subset <- rbind(subset[labels == levels(group)[a], , drop = FALSE], subset[labels == levels(group)[b], , drop = FALSE])
    plans <- suppressWarnings(permuco::Pmat(n = nrow(subset), np = requested + 1L, type = "permutation"))
    for (j in seq_len(K)) {
      stats <- vapply(seq_len(ncol(plans)), function(i) {
        v <- subset[as.integer(plans[, i]), j]
        va <- v[seq_len(sizes[a])]; vb <- v[sizes[a] + seq_len(sizes[b])]
        pooled <- ((sizes[a] - 1L) * stats::var(va) + (sizes[b] - 1L) * stats::var(vb)) / (sizes[a] + sizes[b] - 2L)
        value <- t_value(mean(va) - mean(vb), sqrt(pooled * (1 / sizes[a] + 1 / sizes[b])))
        posthoc_progress(i, ncol(plans))
        value
      }, numeric(1L))
      add("independent", a, b, j, j, list(subset[seq_len(sizes[a]), j],
        subset[sizes[a] + seq_len(sizes[b]), j]), stats, sizes[a], sizes[b])
      completed <- completed + 1L
      progress("Post-hoc", completed, tests)
    }
  }
  comparisons <- as.data.frame(do.call(rbind, rows), stringsAsFactors = FALSE)
  for (name in setdiff(names(comparisons), "type")) comparisons[[name]] <- as.numeric(comparisons[[name]])
  comparisons$adjusted <- stats::p.adjust(comparisons$p, method = "holm")
  list(
    effects = effects, statistic = as.numeric(table[, "F"]), raw = p, adjusted = stats::p.adjust(p, "holm"),
    df1 = as.numeric(table[, "dfn"]), df2 = as.numeric(table[, "dfd"]),
    ms_effect = as.numeric(table[, "MSEn"]), ms_error = as.numeric(table[, "MSEd"]),
    eta = as.numeric(table[, "SSn"] / (table[, "SSn"] + table[, "SSd"])),
    mean = unlist(lapply(summaries, function(x) x$mean)),
    sd = unlist(lapply(summaries, function(x) x$sd)),
    margin = unlist(lapply(summaries, function(x) x$margin)),
    comparisons = as.list(comparisons), resamples = nrow(distribution), sizes = sizes, warnings = warnings,
    software = c(R.version.string, as.character(utils::packageVersion("permuco")))
  )
})
`;

  async function run({ subjects, times, mode, correction, nullValue, permutations, seed, breaks,
    epochs = [], groupNames = [], signal, onStatus = () => {}, onProgress = () => {} }) {
    if (subjects.length < 2 || !times.length) throw new Error('Servono almeno 2 soggetti e un campione condiviso.');
    if (['within', 'mixed'].includes(mode) && (epochs.length < 2 || new Set(epochs).size !== times.length)) {
      throw new Error('Seleziona almeno due epoche distinte per il confronto entro soggetto.');
    }
    if ((permutations + 1) * subjects.length > 5000000) {
      throw new Error('Analisi troppo estesa per webR. Riduci il numero di permutazioni o i campioni della serie.');
    }
    signal?.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => {
        resetRuntime();
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([evaluate(), cancelled]);
    } finally {
      signal?.removeEventListener('abort', abort);
    }

    async function evaluate() {
      if (!session) onStatus('Caricamento di webR e permuco…');
      const runtime = await getRuntime(onStatus);
      signal?.throwIfAborted();
      const runtimeState = session;
      runtimeState.onProgress = onProgress;
      onStatus('Calcolo delle permutazioni in R…');
      signal?.throwIfAborted();
      const shelter = await new runtime.Shelter();
      try {
        const result = await shelter.evalR(progressCode + (mode === 'mixed' ? mixedAnalysis : analysis), {captureStreams: false, env: {
          measurements: subjects.flatMap(subject => subject.values),
          n: subjects.length, k: times.length, mode, correction,
          null_value: mode === 'one' ? nullValue : 0, requested: permutations, seed,
          post_hoc: mode === 'multi' && groupNames.length > 0,
          membership: subjects.map(subject => ['multi', 'mixed'].includes(mode) ? subject.groupIndex + 1 : 1),
          gaps: breaks.map(Number)
        }});
        for (const message of await runtime.flush()) {
          const match = message.type === 'stdout' && /^METRICS_PROGRESS\|([^|]+)\|(\d+)\|(\d+)/.exec(String(message.data).trim());
          if (match) onProgress(Number(match[2]), Number(match[3]), match[1]);
        }
        const payload = await result.toJs();
        const unpack = list => Object.fromEntries(list.names.map((name, index) => {
          const value = list.values[index];
          return [name, value.type === 'list' ? unpack(value) : value.values];
        }));
        const data = unpack(payload);
        if (mode === 'mixed') {
          const n = subjects.length, B = data.resamples[0];
          const effects = {group: 'Gruppo', epoch: 'Epoca', 'group:epoch': 'Gruppo × Epoca'};
          const points = data.effects.map((effect, i) => ({
            label: effects[effect], test: 'F misto a permutazioni', statistic: data.statistic[i],
            pUncorrected: data.raw[i], pAdjusted: data.adjusted[i], df1: data.df1[i], df2: data.df2[i],
            msEffect: data.ms_effect[i], msError: data.ms_error[i], eta: data.eta[i],
            n, resamples: B, correction: 'Holm sui tre effetti omnibus'
          }));
          const cells = data.comparisons;
          const posthoc = cells.type.map((type, i) => {
            const a = cells.a[i] - 1, b = cells.b[i] - 1, j = cells.j[i] - 1, l = cells.l[i] - 1;
            const paired = type === 'paired';
            return {
              kind: paired ? 'mixedPaired' : 'posthoc', test: paired ? 't appaiato (due code)' : 't gruppi indipendenti (permutazioni)',
              epochA: epochs[j], epochB: epochs[l], epochIndex: paired ? null : j,
              groupIndexA: a, groupIndexB: b, groupA: groupNames[a], groupB: groupNames[b],
              nA: cells.nA[i], nB: paired ? null : cells.nB[i], n: cells.nA[i] + cells.nB[i], df1: cells.df[i],
              meanDifference: cells.mean[i], se: cells.se[i], ciLow: cells.low[i], ciHigh: cells.high[i], d: cells.d[i],
              statistic: cells.statistic[i], pUncorrected: cells.p[i], pAdjusted: cells.adjusted[i],
              resamples: cells.resamples[i], correction: 'Holm su tutti gli effetti semplici',
              label: paired ? groupNames[a] + ' · ' + epochs[j] + ' − ' + epochs[l]
                : epochs[j] + ' · ' + groupNames[a] + ' − ' + groupNames[b]
            };
          });
          const groups = groupNames.map((_, group) => times.map((time, index) => {
            const cell = group * times.length + index;
            return {time, mean: data.mean[cell], sd: data.sd[cell], margin: data.margin[cell]};
          }));
          return {points, posthoc, groups, resamples: B, warnings: data.warnings,
            software: {webR: webRVersion, R: data.software[0], permuco: data.software[1]}};
        }
        const contrast = (report, index) => ({
          meanDifference: report.estimate[index], se: report.se[index],
          ciLow: report.low[index], ciHigh: report.high[index], d: report.d[index]
        });
        const fReport = index => ({
          msEffect: data.ms_effect[index], msError: data.ms_error[index], eta: data.eta[index]
        });
        const n = subjects.length;
        const groupCount = data.sizes.length;
        const software = { webR: webRVersion, R: data.software[0], permuco: data.software[1] };
        const points = correction === 'maxT' && mode !== 'within' ? times.map((time, index) => ({
          time, statistic: data.statistic[index], pUncorrected: data.raw[index], pAdjusted: data.adjusted[index],
          ...(mode === 'one'
            ? { ...contrast(data.one_report, index), df1: n - 1 }
            : { ...fReport(index), df1: groupCount - 1, df2: n - groupCount })
        })) : [];
        const clusters = data.start.map((start, index) => ({
          startIndex: start - 1, endIndex: data.end[index] - 1,
          start: times[start - 1], end: times[data.end[index] - 1],
          samples: data.end[index] - start + 1, direction: data.direction[index],
          statistic: data.mass[index], pAdjusted: data.cluster_p[index], threshold: data.threshold[0],
          peakIndex: data.cluster_peak[index] - 1, peakStatistic: data.statistic[data.cluster_peak[index] - 1],
          df1: mode === 'one' ? n - 1 : groupCount - 1,
          df2: mode === 'multi' ? n - groupCount : null
        }));
        const groups = Array.from({length: data.mean.length / times.length}, (_, group) =>
          times.map((time, index) => {
            const cell = group * times.length + index;
            return { time, mean: data.mean[cell], margin: data.margin[cell], sd: data.sd[cell] };
          })
        );
        const resamples = data.resamples[0];
        const pairResult = index => ({
          ...contrast(data.pair_report, index), statistic: data.pair_statistic[index],
          pUncorrected: data.pair_raw[index], pAdjusted: data.pair_adjusted[index], resamples
        });
        if (mode === 'within') {
          const paired = data.pair_a.map((a, index) => {
            const epochA = epochs[a - 1], epochB = epochs[data.pair_b[index] - 1];
            return { ...pairResult(index), epochA, epochB, label: epochA + ' − ' + epochB, n,
              df1: n - 1, test: 't appaiato (due code)',
              correction: epochs.length > 2 ? 'max-|T|' : 'nessuna (una coppia)' };
          });
          const omnibus = data.omnibus.length ? {
            ...fReport(0), label: 'Omnibus · tutte le epoche', test: 'F a misure ripetute',
            statistic: data.omnibus[0], pUncorrected: data.omnibus[1], pAdjusted: data.omnibus[1],
            correction: 'nessuna (un test omnibus)', n, df1: times.length - 1,
            df2: (n - 1) * (times.length - 1), resamples: permutations + 1
          } : null;
          return { points: omnibus ? [omnibus, ...paired] : paired, paired, groups, resamples, software };
        }
        const posthoc = data.pair_a.flatMap((a, pairIndex) => {
          const groupIndexA = a - 1, groupIndexB = data.pair_b[pairIndex] - 1;
          const nA = data.sizes[groupIndexA], nB = data.sizes[groupIndexB];
          return times.map((time, epochIndex) => ({
            ...pairResult(pairIndex * times.length + epochIndex), time, epochIndex,
            groupA: groupNames[groupIndexA], groupB: groupNames[groupIndexB], groupIndexA, groupIndexB,
            n: nA + nB, nA, nB, df1: nA + nB - 2,
            test: 't gruppi indipendenti (permutazioni)', correction: 'max-|T| congiunto: coppie × epoche'
          }));
        });
        return { points, clusters, groups, posthoc, resamples, software, threshold: data.threshold[0] };
      } finally {
        runtimeState.onProgress = null;
        if (!signal?.aborted) await shelter.purge();
      }
    }
  }

  global.MetricsWebR = Object.freeze({ run, prepare: () => getRuntime() });
  getRuntime().catch(() => {});
})(globalThis);
