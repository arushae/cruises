const REFRESH_INTERVAL = 5 * 60 * 1000;
const state = { rewards: [], expiredRewards: [], checkHistory: [], sortKey: 'Partner', sortDirection: 'asc', sortApplied: false };

const searchInput = document.querySelector('#search');
const partnerFilter = document.querySelector('#partner-filter');
const availableBody = document.querySelector('#available-body');
const soldOutBody = document.querySelector('#sold-out-body');
const expiredBody = document.querySelector('#expired-body');
const availableEmpty = document.querySelector('#available-empty');
const soldOutEmpty = document.querySelector('#sold-out-empty');
const expiredEmpty = document.querySelector('#expired-empty');
const availableCount = document.querySelector('#available-count');
const soldOutCount = document.querySelector('#sold-out-count');
const expiredCount = document.querySelector('#expired-count');
const resultCount = document.querySelector('#result-count');
const checkedAt = document.querySelector('#checked-at');
const refreshStatus = document.querySelector('#refresh-status');
const sourceLink = document.querySelector('#source-link');
const sortButtons = document.querySelectorAll('.sort-button');
const pointHistoryDialog = document.querySelector('#points-history-dialog');
const pointHistoryTitle = document.querySelector('#points-history-title');
const pointHistoryBody = document.querySelector('#points-history-body');
const pointHistoryClose = document.querySelector('#points-history-close');
const valueHistoryHeading = document.querySelector('#value-history-heading');
const valueHistoryNote = document.querySelector('#value-history-note');
const checkHistoryButton = document.querySelector('#check-history-button');
const checkHistoryDialog = document.querySelector('#check-history-dialog');
const checkHistoryTitle = document.querySelector('#check-history-title');
const checkHistoryBody = document.querySelector('#check-history-body');
const checkHistoryClose = document.querySelector('#check-history-close');
const columnHelpDialog = document.querySelector('#column-help-dialog');
const columnHelpTitle = document.querySelector('#column-help-title');
const columnHelpText = document.querySelector('#column-help-text');
const columnHelpClose = document.querySelector('#column-help-close');
const EXPIRE_TIME_CHANGE_DISPLAY_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const PORT_COLUMN_HELP = "While this field is named 'port', it has been populated with inconsistent data, ranging from the port, general location of the cruise or the ship.";
const QUANTITY_REPLENISHMENT_NOTE = "It looks as if these rewards are automatically replenished from time to time and the quantity is just a failsafe in case there's a sudden run on them!";
const KONAMI_CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiProgress = 0;

function addLadyShipsEmoji(value) {
  return String(value).replace(/\bLady Ships\b(?!\s*💃)/gi, (match) => `${match} 💃`);
}

function addDisplayFlourishes(value) {
  return addLadyShipsEmoji(value)
    .replace(/\bPride of America\b(?!®)/gi, (match) => `${match}®`);
}

function text(value) { return value == null || value === '' ? '—' : addDisplayFlourishes(value); }

function departurePortsValue(reward) {
  return reward.DeparturePorts || reward.Port;
}

function hasSanDiegoPortException(reward) {
  return Number(reward.OfferID) === 40273 && reward.PointHistoryNote;
}

function metaIcon(label) {
  return {
    'Use by date': '📅',
    'Departure ports': '📍',
    Sailings: '🗓️',
    Ships: '🚢',
    'Redemption limit': '🔁',
    'Offer ID': '#',
  }[label] || '';
}

function formatDate(value, multiline = false) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
  return multiline ? `${datePart}\n${timePart}` : `${datePart}, ${timePart}`;
}

function formatHistoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatHistoryTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC', timeZoneName: 'short',
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatSailings(value) {
  if (!value) return value;
  const rawValue = String(value).trim();
  const exactSlashDate = rawValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (exactSlashDate) {
    const [, month, day, year] = exactSlashDate;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? rawValue : `${formatShortDate(date)} only`;
  }
  const exactLongDate = rawValue.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/);
  if (exactLongDate) {
    const [, monthName, day, year] = exactLongDate;
    const date = new Date(`${monthName} ${day}, ${year} UTC`);
    return Number.isNaN(date.getTime()) ? rawValue : `${formatShortDate(date)} only`;
  }
  return rawValue
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_match, month, day, year) => {
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return Number.isNaN(date.getTime()) ? _match : formatShortDate(date);
    })
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/g,
      (_match, monthName, day, year) => {
        const date = new Date(`${monthName} ${day}, ${year} UTC`);
        return Number.isNaN(date.getTime()) ? _match : formatShortDate(date);
      },
    );
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function createRewardImagePorthole(reward) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const xlinkNS = 'http://www.w3.org/1999/xlink';
  const safeId = String(reward.AwardID || reward.OfferID || Math.random())
    .replace(/[^a-z0-9_-]/gi, '-');
  const clipId = `reward-image-clip-${safeId}`;
  const titleId = `reward-image-title-${safeId}`;

  const figure = document.createElement('figure');
  figure.className = 'reward-image-porthole';
  figure.setAttribute('role', 'img');
  figure.setAttribute('aria-label', reward.RewardPageTitle || reward['Reward title'] || 'Reward image');

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 240');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const title = document.createElementNS(svgNS, 'title');
  title.id = titleId;
  title.textContent = reward.RewardPageTitle || reward['Reward title'] || 'Reward image';
  svg.appendChild(title);

  const defs = document.createElementNS(svgNS, 'defs');
  const clipPath = document.createElementNS(svgNS, 'clipPath');
  clipPath.id = clipId;
  const clipCircle = document.createElementNS(svgNS, 'circle');
  clipCircle.setAttribute('cx', '120');
  clipCircle.setAttribute('cy', '120');
  clipCircle.setAttribute('r', '78');
  clipPath.appendChild(clipCircle);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  const outerRing = document.createElementNS(svgNS, 'circle');
  outerRing.setAttribute('cx', '120');
  outerRing.setAttribute('cy', '120');
  outerRing.setAttribute('r', '111');
  outerRing.setAttribute('fill', '#b8c2c8');
  outerRing.setAttribute('stroke', '#6f7e87');
  outerRing.setAttribute('stroke-width', '8');
  svg.appendChild(outerRing);

  const innerRing = document.createElementNS(svgNS, 'circle');
  innerRing.setAttribute('cx', '120');
  innerRing.setAttribute('cy', '120');
  innerRing.setAttribute('r', '88');
  innerRing.setAttribute('fill', '#eef3f5');
  innerRing.setAttribute('stroke', '#778690');
  innerRing.setAttribute('stroke-width', '7');
  svg.appendChild(innerRing);

  const image = document.createElementNS(svgNS, 'image');
  image.setAttribute('x', '42');
  image.setAttribute('y', '42');
  image.setAttribute('width', '156');
  image.setAttribute('height', '156');
  image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  image.setAttribute('clip-path', `url(#${clipId})`);
  image.setAttribute('href', reward.ImageURL);
  image.setAttributeNS(xlinkNS, 'href', reward.ImageURL);
  svg.appendChild(image);

  const glassRing = document.createElementNS(svgNS, 'circle');
  glassRing.setAttribute('cx', '120');
  glassRing.setAttribute('cy', '120');
  glassRing.setAttribute('r', '78');
  glassRing.setAttribute('fill', 'none');
  glassRing.setAttribute('stroke', 'rgba(255, 255, 255, 0.58)');
  glassRing.setAttribute('stroke-width', '4');
  svg.appendChild(glassRing);

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
    const bolt = document.createElementNS(svgNS, 'circle');
    bolt.setAttribute('cx', String(120 + Math.cos(angle) * 99));
    bolt.setAttribute('cy', String(120 + Math.sin(angle) * 99));
    bolt.setAttribute('r', '5.5');
    bolt.setAttribute('fill', '#eef3f5');
    bolt.setAttribute('stroke', '#65747d');
    bolt.setAttribute('stroke-width', '2');
    svg.appendChild(bolt);
  }

  figure.appendChild(svg);
  return figure;
}

function snipeClass(reward) {
  const snipeText = String(reward.SnipeText || '').toLocaleLowerCase();
  const snipeCategory = String(reward.SnipeCategory || '').toLocaleLowerCase();
  if (snipeCategory === 'soldout' || snipeText.includes('sold out')) return 'snipe snipe-sold-out';
  if (snipeCategory === 'nleft' || /\b\d+\s+left\b/.test(snipeText)) return 'snipe snipe-left';
  if (snipeText.includes('new port')) return 'snipe snipe-new-ports';
  return 'snipe';
}

function arushaNotes(reward) {
  const notes = [];
  const seen = new Set();
  const addNote = (note) => {
    const cleanNote = String(note || '').trim();
    if (!cleanNote || seen.has(cleanNote)) return;
    seen.add(cleanNote);
    notes.push(cleanNote);
  };
  (reward.ArushaNotes || []).forEach(addNote);
  if (String(reward.Partner || '').toLocaleLowerCase().includes('norwegian cruise line')) {
    addNote('NCL offers can be used in conjunction with CruiseNext credits.');
  }
  addNote(reward.PointHistoryNote);
  (reward.ChangeHistory || []).forEach((event) => addNote(event.note));
  if (quantityGoesUpAndDown(reward)) addNote(QUANTITY_REPLENISHMENT_NOTE);
  return notes;
}

function redemptionLimitNote(reward) {
  const limitText = [
    reward.RewardPageLimitText,
    reward.RewardTermsText,
  ].filter(Boolean).join(' ');
  const termsText = String(limitText || '').replace(/\s+/g, ' ').trim();
  if (!termsText) return '';

  const sentences = termsText.match(/[^.!?]+[.!?]+/g) || [termsText];
  const cleanSentences = sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const candidates = cleanSentences.filter((sentence) => {
    const lowerSentence = sentence.toLocaleLowerCase();
    return (
      /\blimit(?:ed)?\b/.test(lowerSentence)
      && (
        /\bper\b/.test(lowerSentence)
        || /\bevery\b/.test(lowerSentence)
        || /\b\d+\s+days?\b/.test(lowerSentence)
        || /\bpurchase\b/.test(lowerSentence)
      )
    );
  });
  const preferred = [
    cleanSentences.find((sentence) => /RCCL\s+Comp\s+Cruise\s+rewards\s+are\s+limited\s+to\s+2\s+purchases\s+in\s+a\s+90\s+day\s+period/i.test(sentence)),
    candidates.find((sentence) => /90\s+days?|in-app reward purchase/i.test(sentence)),
    cleanSentences.find((sentence) => /limit\s+one\s+cruise\s+reward\s+per\s+player,\s+per\s+sailing/i.test(sentence)),
    cleanSentences.find((sentence) => /only\s+one\s+reward\s+may\s+be\s+used\s+per\s+sailing/i.test(sentence)),
    candidates.find((sentence) => /this reward is limited/i.test(sentence)),
    candidates[0],
  ].filter(Boolean).map((sentence) => (
    sentence.replace(/\s+and\s+is\s+not\s+valid\s+on\s+Pride\s+of\s+America®?\s+sailings/iu, '')
  ));
  return Array.from(new Set(preferred)).join(' ');
}

function createRewardPageLink(reward) {
  const link = document.createElement('a');
  link.href = `https://myvip.co/rewardstore/${encodeURIComponent(reward.OfferID)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'reward-link';
  const linkText = document.createElement('span');
  linkText.className = 'reward-link-text';
  linkText.textContent = 'Reward page';
  const linkArrow = document.createElement('span');
  linkArrow.className = 'reward-link-arrow';
  linkArrow.setAttribute('aria-hidden', 'true');
  linkArrow.textContent = '↗';
  link.append(linkText, ' ', linkArrow);
  return link;
}

function quantityGoesUpAndDown(reward) {
  let hasQuantityIncrease = false;
  let hasQuantityDecrease = false;
  const changeHistory = Array.isArray(reward.ChangeHistory) ? reward.ChangeHistory : [];
  changeHistory.forEach((event) => {
    (event.changes || [])
      .filter((change) => change.field === 'Quantity')
      .forEach((change) => {
        const fromValue = Number(change.from);
        const toValue = Number(change.to);
        if (Number.isNaN(fromValue) || Number.isNaN(toValue)) return;
        if (toValue > fromValue) hasQuantityIncrease = true;
        if (toValue < fromValue) hasQuantityDecrease = true;
      });
  });
  return hasQuantityIncrease && hasQuantityDecrease;
}

function compareRewards(a, b) {
  if (!state.sortApplied) {
    const partnerDifference = String(a.Partner || '').localeCompare(
      String(b.Partner || ''),
      undefined,
      { sensitivity: 'base' },
    );
    if (partnerDifference !== 0) return partnerDifference;

    const leftPoints = typeof a.Points === 'number' ? a.Points : Number.POSITIVE_INFINITY;
    const rightPoints = typeof b.Points === 'number' ? b.Points : Number.POSITIVE_INFINITY;
    return leftPoints - rightPoints;
  }

  let left = a[state.sortKey];
  let right = b[state.sortKey];

  if (state.sortKey === 'DeparturePorts') {
    left = departurePortsValue(a);
    right = departurePortsValue(b);
  }

  if (state.sortKey === 'ExpireTime') {
    left = left ? new Date(left).getTime() : null;
    right = right ? new Date(right).getTime() : null;
  }

  let result;
  if (left == null || left === '') result = right == null || right === '' ? 0 : 1;
  else if (right == null || right === '') result = -1;
  else if (typeof left === 'number' || typeof left === 'boolean') result = Number(left) - Number(right);
  else result = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });

  return state.sortDirection === 'asc' ? result : -result;
}

function formatChangeValue(field, value) {
  if (field === 'ExpireTime') return formatDate(value);
  if ((field === 'Points' || field === 'Quantity' || field === 'StrikeOutPrice') && typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return text(value);
}

function shouldDisplayObservedChange(change) {
  if (['RewardDescription', 'RewardUseByText', 'RewardPageLimitText', 'RewardTermsText', 'RewardTermsExtractedAt', 'SnipeText'].includes(change.field)) return false;
  if (change.field !== 'ExpireTime') return true;
  const fromTime = new Date(change.from).getTime();
  const toTime = new Date(change.to).getTime();
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) return true;
  return Math.abs(toTime - fromTime) > EXPIRE_TIME_CHANGE_DISPLAY_THRESHOLD_MS;
}

function formatNumber(value) {
  return typeof value === 'number' ? value.toLocaleString() : text(value);
}

function addInlineHistoryButton(cell, reward, type, labelText) {
  const historyWrap = document.createElement('span');
  historyWrap.className = 'previous-history';
  const previousLabel = document.createElement('span');
  previousLabel.className = 'previous-points';
  previousLabel.textContent = labelText;
  const historyButton = document.createElement('button');
  historyButton.type = 'button';
  historyButton.className = 'point-history-button';
  historyButton.dataset.awardId = reward.AwardID;
  historyButton.dataset.historyType = type;
  historyButton.setAttribute('aria-label', `View ${type} history for ${reward['Reward title']}`);
  historyButton.title = `View ${type} history`;
  historyButton.textContent = '?';
  historyWrap.append(historyButton, previousLabel);
  cell.append(document.createElement('br'), historyWrap);
}

function addRewardNoteButton(cell, reward) {
  const historyButton = document.createElement('button');
  historyButton.type = 'button';
  historyButton.className = 'point-history-button inline-note-button';
  historyButton.dataset.awardId = reward.AwardID;
  historyButton.dataset.historyType = 'points';
  historyButton.setAttribute('aria-label', `View note for ${reward['Reward title']}`);
  historyButton.title = 'View note';
  historyButton.textContent = '?';
  cell.append(' ', historyButton);
}

function createRewardRows(reward) {
  const row = document.createElement('tr');
  const detailId = `reward-details-${reward.AwardID}`;
  row.classList.add('reward-row');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-expanded', 'false');
  row.setAttribute('aria-controls', detailId);
  row.dataset.awardId = reward.AwardID;
  const toggleCell = addCell(row, '', 'toggle-cell');
  toggleCell.textContent = '';
  toggleCell.setAttribute('aria-hidden', 'true');
  addCell(row, reward.Partner);
  const titleCell = addCell(row, reward['Reward title'], 'reward-title-cell');
  if (reward.SnipeText) {
    const badge = document.createElement('span');
    badge.className = snipeClass(reward);
    badge.textContent = reward.SnipeText;
    titleCell.append(document.createElement('br'), badge);
  }
  const pointsCell = addCell(row, formatNumber(reward.Points), 'points');
  const pointHistory = Array.isArray(reward.PointHistory) ? reward.PointHistory : [];
  const previousDifferent = [...pointHistory].reverse().find((entry) => entry.value !== reward.Points);
  if (previousDifferent) {
    addInlineHistoryButton(pointsCell, reward, 'points', `(previously\nseen at ${formatNumber(previousDifferent.value)})`);
  }
  const quantityCell = addCell(row, reward.Quantity, reward.Quantity === 0 ? 'quantity sold-out' : 'quantity');
  if (
    reward.HighestQuantityObserved != null
    && reward.HighestQuantityObserved !== ''
    && reward.HighestQuantityObserved !== reward.Quantity
  ) {
    addInlineHistoryButton(
      quantityCell,
      reward,
      'quantity',
      `(previously\nseen at ${formatNumber(reward.HighestQuantityObserved)})`,
    );
  }
  addCell(row, formatDate(reward.ExpireTime, true), 'expiry');
  const departurePortsCell = addCell(row, departurePortsValue(reward));
  if (hasSanDiegoPortException(reward)) {
    departurePortsCell.classList.add('port-note-highlight');
    addRewardNoteButton(departurePortsCell, reward);
  }
  addCell(row, formatSailings(reward.Sailings));
  addCell(row, reward.Ships);
  addCell(row, reward.IsPremium ? 'Yes' : 'No');
  const portCell = addCell(row, reward.Port);
  if (hasSanDiegoPortException(reward)) {
    portCell.classList.add('port-note-highlight');
    addRewardNoteButton(portCell, reward);
  }
  addCell(row, reward.OfferID, 'offer-id');

  const detailRow = document.createElement('tr');
  detailRow.id = detailId;
  detailRow.className = 'reward-details';
  detailRow.hidden = true;
  const detailCell = document.createElement('td');
  detailCell.colSpan = 12;
  const detailContent = document.createElement('div');
  detailContent.className = 'reward-details-content';

  if (reward.ImageURL) {
    detailContent.appendChild(createRewardImagePorthole(reward));
  }

  if (reward.RewardPageTitle) {
    const pageTitle = document.createElement('h3');
    pageTitle.className = 'reward-page-title';
    pageTitle.textContent = reward.RewardPageTitle;
    detailContent.appendChild(pageTitle);
  }

  if (reward.RewardDescription) {
    const description = document.createElement('p');
    description.className = 'reward-description';
    description.textContent = reward.RewardDescription;
    detailContent.appendChild(description);
  }

  if (reward.OfferID != null && reward.OfferID !== '') {
    detailContent.appendChild(createRewardPageLink(reward));
  }

  const redemptionLimit = redemptionLimitNote(reward);
  const metaRows = [
    ['Use by date', reward.RewardUseByText],
    ['Departure ports', departurePortsValue(reward)],
    ['Sailings', formatSailings(reward.Sailings)],
    ['Ships', reward.Ships],
    ['Redemption limit', redemptionLimit],
    ['Offer ID', text(reward.OfferID)],
  ].filter(([, value]) => value != null && value !== '');
  if (metaRows.length) {
    const metaList = document.createElement('dl');
    metaList.className = 'reward-meta-list detail-section-divider';
    metaRows.forEach(([label, value]) => {
      const icon = document.createElement('span');
      icon.className = 'reward-meta-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = metaIcon(label);
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = addDisplayFlourishes(value);
      metaList.append(icon, term, description);
    });
    detailContent.appendChild(metaList);
  }

  const notes = arushaNotes(reward);
  if (notes.length) {
    const notesHeading = document.createElement('h3');
    notesHeading.className = 'detail-section-heading';
    notesHeading.textContent = "📝 Arusha's notes";
    detailContent.appendChild(notesHeading);
    const notesList = document.createElement('ul');
    notesList.className = 'arusha-notes';
    notes.forEach((note) => {
      const item = document.createElement('li');
      item.textContent = note;
      notesList.appendChild(item);
    });
    detailContent.appendChild(notesList);
  }

  const heading = document.createElement('h3');
  heading.className = 'detail-section-heading';
  heading.textContent = "🦜 Captain Pistachio's observed changes";
  detailContent.appendChild(heading);

  const changeHistory = Array.isArray(reward.ChangeHistory) ? reward.ChangeHistory : [];
  const changeList = document.createElement('ul');
  let displayedChanges = 0;
  if (changeHistory.length) {
    changeHistory.forEach((event) => {
      if (event.note) {
        const noteItem = document.createElement('li');
        noteItem.textContent = event.note;
        changeList.appendChild(noteItem);
        displayedChanges += 1;
      }
      (event.changes || []).filter(shouldDisplayObservedChange).forEach((change) => {
        const item = document.createElement('li');
        const when = `${formatHistoryDate(event.observed_at)}, ${formatHistoryTime(event.observed_at)}`;
        item.textContent = `${when} — ${change.field}: ${formatChangeValue(change.field, change.from)} → ${formatChangeValue(change.field, change.to)}`;
        changeList.appendChild(item);
        displayedChanges += 1;
      });
    });
  }
  if (!displayedChanges) {
    const item = document.createElement('li');
    item.textContent = 'No changes observed yet.';
    changeList.appendChild(item);
  }
  detailContent.appendChild(changeList);

  if (reward.RewardTermsText) {
    const terms = document.createElement('details');
    terms.className = 'reward-terms';
    const termsSummary = document.createElement('summary');
    termsSummary.textContent = 'Terms and conditions';
    const termsExtractedAt = document.createElement('p');
    termsExtractedAt.className = 'reward-terms-date';
    termsExtractedAt.textContent = `Extracted ${formatDate(reward.RewardTermsExtractedAt || state.checkHistory[state.checkHistory.length - 1])}`;
    const termsBody = document.createElement('p');
    termsBody.textContent = addDisplayFlourishes(reward.RewardTermsText);
    terms.append(termsSummary, termsExtractedAt, termsBody);
    detailContent.appendChild(terms);
  }

  if (reward.OfferID == null || reward.OfferID === '') {
    const unavailable = document.createElement('p');
    unavailable.className = 'muted';
    unavailable.textContent = 'No offer number is available for this reward.';
    detailContent.appendChild(unavailable);
  }
  detailCell.appendChild(detailContent);
  detailRow.appendChild(detailCell);
  return [row, detailRow];
}

function renderTable(body, rewards, emptyState) {
  body.replaceChildren(...rewards.flatMap(createRewardRows));
  emptyState.hidden = rewards.length !== 0;
}

function updateSortHeaders() {
  sortButtons.forEach((button) => {
    const active = button.dataset.sort === state.sortKey;
    const header = button.closest('th');
    if (active) {
      header.setAttribute('aria-sort', state.sortDirection === 'asc' ? 'ascending' : 'descending');
      button.title = `Sorted ${state.sortDirection === 'asc' ? 'ascending' : 'descending'}; click to reverse`;
    } else {
      header.removeAttribute('aria-sort');
      button.title = `Sort by ${button.textContent.trim()}`;
    }
  });
}

function render() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const partner = partnerFilter.value;
  const matchesFilters = (reward) => {
    const haystack = [
      reward.Partner,
      reward['Reward title'],
      reward.Port,
      departurePortsValue(reward),
      reward.Sailings,
      reward.Ships,
      reward.SnipeText,
      reward.SnipeCategory,
    ].join(' ').toLocaleLowerCase();
    return (!partner || reward.Partner === partner) && (!query || haystack.includes(query));
  };
  const filtered = state.rewards.filter(matchesFilters).sort(compareRewards);
  const expired = state.expiredRewards.filter(matchesFilters).sort(compareRewards);

  const available = filtered.filter((reward) => reward.Quantity !== 0);
  const soldOut = filtered.filter((reward) => reward.Quantity === 0);

  renderTable(availableBody, available, availableEmpty);
  renderTable(soldOutBody, soldOut, soldOutEmpty);
  renderTable(expiredBody, expired, expiredEmpty);

  resultCount.textContent = `${filtered.length + expired.length} of ${state.rewards.length + state.expiredRewards.length} rewards`;
  availableCount.textContent = `${available.length} rewards`;
  soldOutCount.textContent = `${soldOut.length} rewards`;
  expiredCount.textContent = `${expired.length} rewards`;
  updateSortHeaders();
}

function updatePartners() {
  const selected = partnerFilter.value;
  const partners = [...new Set([...state.rewards, ...state.expiredRewards].map((reward) => reward.Partner).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  partnerFilter.replaceChildren(new Option('All partners', ''));
  partners.forEach((partner) => partnerFilter.add(new Option(partner, partner)));
  partnerFilter.value = partners.includes(selected) ? selected : '';
}

async function loadRewards() {
  refreshStatus.textContent = 'Checking for updated data…';
  try {
    const cacheBuster = Date.now();
    const [response, expiredResponse] = await Promise.all([
      fetch(`rewards.json?t=${cacheBuster}`, { cache: 'no-store' }),
      fetch(`expired.json?t=${cacheBuster}`, { cache: 'no-store' }),
    ]);
    if (!response.ok) throw new Error(`rewards.json HTTP ${response.status}`);
    if (!expiredResponse.ok) throw new Error(`expired.json HTTP ${expiredResponse.status}`);
    const [data, expiredData] = await Promise.all([response.json(), expiredResponse.json()]);
    state.rewards = Array.isArray(data.rewards) ? data.rewards : [];
    state.expiredRewards = Array.isArray(expiredData.rewards) ? expiredData.rewards : [];
    state.checkHistory = Array.isArray(data.check_history) ? data.check_history : [data.checked_at].filter(Boolean);
    checkedAt.textContent = `Last checked:\n${formatDate(data.checked_at)}`;
    sourceLink.href = data.source_url || '#';
    updatePartners();
    render();
    refreshStatus.textContent = '';
  } catch (error) {
    refreshStatus.textContent = `Could not load rewards.json (${error.message})`;
  }
}

searchInput.addEventListener('input', render);
partnerFilter.addEventListener('change', render);
sortButtons.forEach((button) => button.addEventListener('click', () => {
  const key = button.dataset.sort;
  state.sortApplied = true;
  if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  else {
    state.sortKey = key;
    state.sortDirection = 'asc';
  }
  render();
}));
loadRewards();
setInterval(loadRewards, REFRESH_INTERVAL);

function openPointHistory(awardId) {
  const reward = [...state.rewards, ...state.expiredRewards].find((item) => String(item.AwardID) === String(awardId));
  if (!reward) return;
  pointHistoryTitle.textContent = `${reward.Partner} — ${reward['Reward title']}`;
  valueHistoryHeading.textContent = 'Points';
  valueHistoryNote.hidden = !reward.PointHistoryNote;
  valueHistoryNote.textContent = reward.PointHistoryNote || '';
  const history = Array.isArray(reward.PointHistory) ? reward.PointHistory : [];
  const rows = history.length ? history.map((entry) => {
    const row = document.createElement('tr');
    addCell(row, formatHistoryDate(entry.observed_at));
    addCell(row, formatHistoryTime(entry.observed_at));
    addCell(row, typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value, 'points');
    return row;
  }) : [(() => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No point history recorded yet.';
    row.appendChild(cell);
    return row;
  })()];
  pointHistoryBody.replaceChildren(...rows);
  pointHistoryDialog.showModal();
}

function openQuantityHistory(awardId) {
  const reward = [...state.rewards, ...state.expiredRewards].find((item) => String(item.AwardID) === String(awardId));
  if (!reward) return;
  pointHistoryTitle.textContent = `${reward.Partner} — ${reward['Reward title']}`;
  valueHistoryHeading.textContent = 'Quantity';
  const seen = new Set();
  const rowsData = [];
  const addHistoryValue = (observedAt, value) => {
    const key = `${observedAt || ''}|${value}`;
    if (value == null || value === '' || seen.has(key)) return;
    seen.add(key);
    rowsData.push({ observed_at: observedAt, value });
  };
  const changeHistory = Array.isArray(reward.ChangeHistory) ? reward.ChangeHistory : [];
  changeHistory.forEach((event) => {
    (event.changes || [])
      .filter((change) => change.field === 'Quantity')
      .forEach((change) => {
        addHistoryValue(event.observed_at, change.from);
        addHistoryValue(event.observed_at, change.to);
      });
  });
  const showQuantityNote = quantityGoesUpAndDown(reward);
  valueHistoryNote.hidden = !showQuantityNote;
  valueHistoryNote.textContent = showQuantityNote ? QUANTITY_REPLENISHMENT_NOTE : '';
  if (reward.HighestQuantityObserved != null && reward.HighestQuantityObserved !== '') {
    addHistoryValue(reward.checked_at || state.checkHistory[0], reward.HighestQuantityObserved);
  }
  addHistoryValue(state.checkHistory[state.checkHistory.length - 1], reward.Quantity);
  pointHistoryBody.replaceChildren(...(rowsData.length ? rowsData.map((entry) => {
    const row = document.createElement('tr');
    addCell(row, formatHistoryDate(entry.observed_at));
    addCell(row, formatHistoryTime(entry.observed_at));
    addCell(row, formatNumber(entry.value), 'points');
    return row;
  }) : [(() => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No quantity history recorded yet.';
    row.appendChild(cell);
    return row;
  })()]));
  pointHistoryDialog.showModal();
}

function openCheckHistory() {
  checkHistoryTitle.textContent = `Site check history (${state.checkHistory.length})`;
  checkHistoryBody.replaceChildren(...[...state.checkHistory].reverse().map((observedAt) => {
    const row = document.createElement('tr');
    addCell(row, formatHistoryDate(observedAt));
    addCell(row, formatHistoryTime(observedAt));
    return row;
  }));
  checkHistoryDialog.showModal();
}

function openColumnHelp(title, textContent) {
  columnHelpTitle.textContent = title;
  columnHelpText.textContent = textContent;
  columnHelpDialog.showModal();
}

document.addEventListener('click', (event) => {
  const columnHelpButton = event.target.closest('.column-help-button');
  if (columnHelpButton) {
    event.preventDefault();
    event.stopPropagation();
    openColumnHelp('Port', PORT_COLUMN_HELP);
    return;
  }
  const historyButton = event.target.closest('.point-history-button');
  if (historyButton) {
    event.preventDefault();
    event.stopPropagation();
    if (historyButton.dataset.historyType === 'quantity') openQuantityHistory(historyButton.dataset.awardId);
    else openPointHistory(historyButton.dataset.awardId);
    return;
  }
  if (event.target.closest('a, button, input, select')) return;
  const rewardRow = event.target.closest('.reward-row');
  if (rewardRow) toggleRewardRow(rewardRow);
});
document.addEventListener('keydown', (event) => {
  const rewardRow = event.target.closest('.reward-row');
  if (rewardRow && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    toggleRewardRow(rewardRow);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, select, textarea')) return;
  const expectedKey = KONAMI_CODE[konamiProgress];
  const pressedKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  konamiProgress = pressedKey === expectedKey ? konamiProgress + 1 : (pressedKey === KONAMI_CODE[0] ? 1 : 0);
  if (konamiProgress === KONAMI_CODE.length) {
    konamiProgress = 0;
    launchDuckSwim();
  }
});

function launchDuckSwim() {
  const pond = document.createElement('div');
  pond.className = 'duck-pond';
  pond.setAttribute('aria-hidden', 'true');
  document.body.appendChild(pond);

  const duckCount = 9;
  for (let index = 0; index < duckCount; index += 1) {
    const duck = document.createElement('span');
    duck.className = 'konami-duck';
    duck.style.setProperty('--duck-top', `${14 + ((index * 9) % 66)}vh`);
    duck.style.setProperty('--duck-delay', `${index * 0.28}s`);
    duck.style.setProperty('--duck-duration', `${6.2 + (index % 4) * 0.7}s`);
    duck.style.setProperty('--duck-size', `${2.2 + (index % 3) * 0.45}rem`);
    pond.appendChild(duck);
  }

  const parrot = document.createElement('span');
  parrot.className = 'konami-parrot';
  parrot.textContent = '🦜';
  pond.appendChild(parrot);

  window.setTimeout(() => pond.remove(), 12500);
}

function toggleRewardRow(row) {
  const detailRow = document.getElementById(row.getAttribute('aria-controls'));
  if (!detailRow) return;
  const expanded = row.getAttribute('aria-expanded') === 'true';
  row.setAttribute('aria-expanded', String(!expanded));
  detailRow.hidden = expanded;
}
pointHistoryClose.addEventListener('click', () => pointHistoryDialog.close());
checkHistoryButton.addEventListener('click', openCheckHistory);
checkHistoryClose.addEventListener('click', () => checkHistoryDialog.close());
columnHelpClose.addEventListener('click', () => columnHelpDialog.close());
