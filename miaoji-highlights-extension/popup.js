const btn = document.getElementById('exportBtn');
const status = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');

function setProgress(pct) {
  progressWrap.style.display = 'block';
  progressBar.style.width = pct + '%';
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.className = '';
  status.textContent = '扫描中...';
  setProgress(5);

  const onMessage = (msg) => {
    if (msg.type === 'progress') {
      setProgress(Math.round(msg.pct));
      status.textContent = `滚动读取中... ${msg.zones} 段`;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractHighlights,
    });

    setProgress(100);

    if (result.error) {
      status.textContent = result.error;
      status.className = 'error';
    } else {
      // Download in popup context
      const blob = new Blob([result.tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'feishu-highlights.tsv';
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = `完成 — 导出 ${result.count} 条高亮`;
      status.className = 'success';
    }
  } catch (e) {
    status.textContent = '错误: ' + e.message;
    status.className = 'error';
  } finally {
    chrome.runtime.onMessage.removeListener(onMessage);
    btn.disabled = false;
  }
});

async function extractHighlights() {
  const paragraphData = new Map();
  const processedZones = new Set();
  const container = document.querySelector('.rc-virtual-list-holder');

  if (!container) {
    return { error: '未找到转写容器，请确认在飞书妙记页面' };
  }

  function parseTimeToMs(timeStr) {
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    return 0;
  }

  function collectParagraphs() {
    document.querySelectorAll('.transcript-paragraph-item').forEach(p => {
      const zoneEl = p.querySelector('[data-zone-id]');
      if (!zoneEl) return;
      const zoneId = zoneEl.getAttribute('data-zone-id');
      if (processedZones.has(zoneId)) return;
      processedZones.add(zoneId);

      const speaker = p.querySelector('[user-name-content]')?.getAttribute('user-name-content') || '';
      const timeContent = p.querySelector('[time-content]')?.getAttribute('time-content') || '';
      const sentenceWrappers = Array.from(p.querySelectorAll('.minutes-sentence-wrapper'));

      if (!sentenceWrappers.length || !timeContent) return;

      const paraStartMs = parseTimeToMs(timeContent);

      const timestamps = [];
      const sentences = sentenceWrappers.map(wrapper => {
        const sid = wrapper.getAttribute('data-sid');
        if (!sid) return null;
        const [startNs, endNs] = sid.split('-').map(s => parseInt(s, 10));
        const startTs = startNs / 1e6;
        const endTs = endNs / 1e6;
        timestamps.push(startTs, endTs);

        const allText = wrapper.textContent;
        return { startTs, endTs, allText, charCount: allText.length };
      }).filter(s => s !== null);

      if (!sentences.length) return;

      const dataStart = Math.min(...timestamps);
      const dataEnd = Math.max(...timestamps);
      const paraDurationMs = dataEnd - dataStart;
      const totalChars = sentences.reduce((sum, s) => sum + s.charCount, 0);

      const segments = [];
      let paraCharPos = 0;

      sentenceWrappers.forEach(wrapper => {
        const sid = wrapper.getAttribute('data-sid');
        if (!sid) return;

        const runs = [];
        function walkNode(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.length > 0) {
              const isHighlighted = node.parentElement.closest('.minutes-mark-background') !== null;
              runs.push({ type: isHighlighted ? 'highlight' : 'gap', text });
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            for (const child of node.childNodes) {
              walkNode(child);
            }
          }
        }
        walkNode(wrapper);

        const mergedRuns = [];
        for (const run of runs) {
          const last = mergedRuns[mergedRuns.length - 1];
          if (last && last.type === run.type) {
            last.text += run.text;
          } else {
            mergedRuns.push({ ...run });
          }
        }

        for (const run of mergedRuns) {
          const runStart = paraStartMs + (paraCharPos / totalChars) * paraDurationMs;
          const runEnd = paraStartMs + ((paraCharPos + run.text.length) / totalChars) * paraDurationMs;
          segments.push({ type: run.type, text: run.text, startTs: runStart, endTs: runEnd });
          paraCharPos += run.text.length;
        }
      });

      paragraphData.set(zoneId, { speaker, segments, sortTs: paraStartMs });
    });
  }

  // Scroll through entire transcript
  collectParagraphs();
  let lastZoneCount = processedZones.size;
  let stableRounds = 0;
  const scrollHeight = container.scrollHeight;
  while (stableRounds < 5) {
    container.scrollTop = container.scrollTop + 500;
    await new Promise(r => setTimeout(r, 250));
    collectParagraphs();
    const pct = 5 + (container.scrollTop / scrollHeight) * 85;
    chrome.runtime.sendMessage({ type: 'progress', pct: Math.min(pct, 90), zones: processedZones.size });
    if (processedZones.size === lastZoneCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastZoneCount = processedZones.size;
    }
  }
  container.scrollTop = 0;

  // Sort and flatten
  const sortedParas = [...paragraphData.values()].sort((a, b) => a.sortTs - b.sortTs);
  const allSegments = [];
  for (const para of sortedParas) {
    for (const seg of para.segments) {
      allSegments.push({ ...seg, speaker: para.speaker });
    }
  }

  // Merge consecutive highlights
  const results = [];
  let current = null;
  for (const seg of allSegments) {
    if (seg.type === 'highlight') {
      if (current) {
        current.text += seg.text;
        current.endTs = seg.endTs;
      } else {
        current = { speaker: seg.speaker, text: seg.text, startTs: seg.startTs, endTs: seg.endTs };
      }
    } else {
      if (current) {
        results.push(current);
        current = null;
      }
    }
  }
  if (current) results.push(current);

  if (!results.length) {
    return { error: '未找到高亮文本' };
  }

  // Build TSV and return to popup for download
  function msToTime(ms) {
    if (isNaN(ms) || ms < 0) return '0.00';
    return (ms / 1000).toFixed(2);
  }

  const tsvHeader = 'start\tend\ttext';
  const tsvRows = results.map(r => `${msToTime(r.startTs)}\t${msToTime(r.endTs)}\t${r.text}`);
  const tsv = [tsvHeader, ...tsvRows].join('\n');

  return { count: results.length, tsv };
}
