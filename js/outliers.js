(function(root){
function getSeries(subject, metric, condition){return subject.dataByMetric?.[metric]?.[condition] || [];}
function getOutlierFlags(subjects, metric, condition = '', method = 'iqr') {
  const minimumGroupSize = 5;
  const zThreshold = 3.5;
  const minimumDeviatingPoints = 3;
  const minimumDeviatingFraction = 0.1;
  const byTime = new Map();
  const flags = new Map(subjects.map(subject => [subject.id, { status: 'insufficient', tested: 0, deviating: 0 }]));

  if (method === 'none') {
    for (const flag of flags.values()) flag.status = 'disabled';
    return flags;
  }

  if (method === 'mean-iqr') {
    return getTemporalMeanOutlierFlags(subjects, metric, condition, minimumGroupSize, flags);
  }

  for (const subject of subjects) {
    for (const point of getSeries(subject, metric, condition)) {
      if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
      if (!byTime.has(point.time)) byTime.set(point.time, []);
      byTime.get(point.time).push({ subjectId: subject.id, value: point.value });
    }
  }

  for (const valuesAtTime of byTime.values()) {
    if (valuesAtTime.length < minimumGroupSize) continue;

    const values = valuesAtTime.map(item => item.value);
    const center = median(values);
    const mad = median(values.map(value => Math.abs(value - center)));
    const zeroScaleTolerance = Number.EPSILON * Math.max(1, Math.abs(center)) * 16;
    const firstQuartile = percentile(values, 0.25);
    const thirdQuartile = percentile(values, 0.75);
    const iqr = thirdQuartile - firstQuartile;
    const lowerFence = firstQuartile - 1.5 * iqr;
    const upperFence = thirdQuartile + 1.5 * iqr;

    for (const item of valuesAtTime) {
      const flag = flags.get(item.subjectId);
      flag.tested++;
      const deviation = Math.abs(item.value - center);
      const robustZ = mad > zeroScaleTolerance ? 0.6745 * deviation / mad : deviation > zeroScaleTolerance ? Infinity : 0;
      const isOutlier = method === 'mad'
        ? robustZ > zThreshold
        : item.value < lowerFence || item.value > upperFence;
      if (isOutlier) flag.deviating++;
    }
  }

  for (const flag of flags.values()) {
    const requiredPoints = Math.max(minimumDeviatingPoints, Math.ceil(flag.tested * minimumDeviatingFraction));
    flag.status = flag.tested < minimumDeviatingPoints
      ? 'insufficient'
      : flag.deviating >= requiredPoints
        ? 'flagged'
        : 'within';
    flag.fraction = flag.tested ? flag.deviating / flag.tested : 0;
  }

  return flags;
}

function getTemporalMeanOutlierFlags(subjects, metric, condition, minimumGroupSize, flags) {
  const temporalMeans = [];

  for (const subject of subjects) {
    const pointsByTime = new Map();
    for (const point of getSeries(subject, metric, condition)) {
      if (Number.isFinite(point.time) && Number.isFinite(point.value)) {
        pointsByTime.set(point.time, point.value);
      }
    }

    const points = [...pointsByTime]
      .map(([time, value]) => ({ time, value }))
      .sort((left, right) => left.time - right.time);
    if (points.length < 2) continue;

    let area = 0;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      area += (current.time - previous.time) * (previous.value + current.value) / 2;
    }

    const duration = points.at(-1).time - points[0].time;
    if (duration > 0) temporalMeans.push({ subjectId: subject.id, value: area / duration });
  }

  if (temporalMeans.length < minimumGroupSize) return flags;

  const means = temporalMeans.map(item => item.value);
  const firstQuartile = percentile(means, 0.25);
  const thirdQuartile = percentile(means, 0.75);
  const iqr = thirdQuartile - firstQuartile;
  const lowerFence = firstQuartile - 1.5 * iqr;
  const upperFence = thirdQuartile + 1.5 * iqr;

  for (const item of temporalMeans) {
    const isOutlier = item.value < lowerFence || item.value > upperFence;
    flags.set(item.subjectId, {
      status: isOutlier ? 'flagged' : 'within',
      tested: 1,
      deviating: isOutlier ? 1 : 0,
      fraction: isOutlier ? 1 : 0,
      temporalMean: item.value,
      lowerFence,
      upperFence
    });
  }

  return flags;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}


const api={getOutlierFlags,percentile};if(typeof module!=='undefined')module.exports=api;else root.MetricsOutliers=api;
})(globalThis);