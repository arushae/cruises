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

function text(value) { return value == null || value === '' ? '—' : String(value); }
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

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function snipeClass(reward) {
  const snipeText = String(reward.SnipeText || '').toLocaleLowerCase();
  const snipeCategory = String(reward.SnipeCategory || '').toLocaleLowerCase();
  if (snipeCategory === 'soldout' || snipeText.includes('sold out')) return 'snipe snipe-sold-out';
  if (snipeCategory === 'nleft' || /\b\d+\s+left\b/.test(snipeText)) return 'snipe snipe-left';
  if (snipeText.includes('new port')) return 'snipe snipe-new-ports';
  return 'snipe';
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
  if (change.field === 'RewardDescription') return false;
  if (
    change.field === 'RewardUseByText'
    && (change.from == null || change.from === '')
    && change.to
  ) return false;
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
  cell.append(document.createElement('br'), previousLabel, historyButton);
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
    addInlineHistoryButton(pointsCell, reward, 'points', `(previously seen\nat ${formatNumber(previousDifferent.value)})`);
  }
  addCell(row, reward.Port);
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
      `(previously seen\nat ${formatNumber(reward.HighestQuantityObserved)})`,
    );
  }
  addCell(row, formatDate(reward.ExpireTime, true), 'expiry');
  addCell(row, reward.IsPremium ? 'Yes' : 'No');

  const detailRow = document.createElement('tr');
  detailRow.id = detailId;
  detailRow.className = 'reward-details';
  detailRow.hidden = true;
  const detailCell = document.createElement('td');
  detailCell.colSpan = 8;
  const detailContent = document.createElement('div');
  detailContent.className = 'reward-details-content';

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

  if (reward.RewardUseByText) {
    const useBy = document.createElement('p');
    useBy.className = 'reward-use-by';
    const useByLabel = document.createElement('strong');
    useByLabel.textContent = 'Use by date:';
    useBy.append(useByLabel, ` ${reward.RewardUseByText}`);
    detailContent.appendChild(useBy);
  }

  const offerMeta = document.createElement('p');
  offerMeta.className = 'reward-meta';
  const offerLabel = document.createElement('strong');
  offerLabel.textContent = 'Offer ID:';
  offerMeta.append(offerLabel, ` ${text(reward.OfferID)}`);
  detailContent.appendChild(offerMeta);

  const heading = document.createElement('h3');
  heading.textContent = 'Observed changes';
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

  if (reward.OfferID != null && reward.OfferID !== '') {
    const link = document.createElement('a');
    link.href = `https://myvip.co/rewardstore/${encodeURIComponent(reward.OfferID)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reward-link';
    link.textContent = 'Open the actual reward page ↗';
    detailContent.appendChild(link);
  } else {
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
    const haystack = [reward.Partner, reward['Reward title'], reward.Port, reward.SnipeText, reward.SnipeCategory].join(' ').toLocaleLowerCase();
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
