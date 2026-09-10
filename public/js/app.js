window.disable_adaptive = function () {
  document.body.style.minWidth = "990px";
};

document.addEventListener('click', function(e) {
  var td = e.target.closest('.div_topic_votes_buttons td, .div_comment_votes_buttons td');
  if (!td) return;
  var ctrl = td.closest('[id^="div_vote_"]');
  if (!ctrl) return;
  var match = ctrl.id.match(/div_vote_(\d+)_(\d+)/);
  if (!match) return;
  var entityType = match[1] === '0' ? 'topics' : 'comments';
  var entityId = match[2];
  var isUp = td.textContent.trim() === '+';
  var value = isUp ? 'up' : 'down';

  fetch('/' + entityType + '/' + entityId + '/vote/', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    credentials: 'same-origin',
    body: 'value=' + value
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (!d.ok) return;
    var score = d.up - d.down;
    var scoreEl = ctrl.querySelector('.div_topic_votes_current nobr, .div_comment_votes_current');
    if (scoreEl) {
      var n = scoreEl.tagName === 'NOBR' ? scoreEl : scoreEl.querySelector('nobr');
      if (n) n.textContent = score > 0 ? '+' + score : '' + score;
    }
    var adv = ctrl.querySelector('.div_topic_votes_advanced');
    if (adv) {
      var nobs = adv.querySelectorAll('nobr');
      if (nobs[0]) nobs[0].textContent = d.up + ' понравилось';
      if (nobs[1]) nobs[1].textContent = d.down + ' не понравилось';
      var tds = adv.querySelectorAll('table td');
      var total = d.up + d.down;
      var upPx = total === 0 ? 0 : Math.round((d.up / total) * 120);
      var downPx = total === 0 ? 120 : 120 - upPx;
      if (tds[0]) tds[0].style.width = upPx + 'px';
      if (tds[1]) tds[1].style.width = downPx + 'px';
    }
    var cAdv = ctrl.querySelector('.div_votes_control, table');
    if (cAdv && !adv) {
      var cNobr = ctrl.querySelector('.div_comment_votes_current nobr');
      if (cNobr) {
        cNobr.textContent = score;
        var cScoreEl = ctrl.querySelector('.div_comment_votes_current');
        if (cScoreEl) {
          if (score === 0) cScoreEl.classList.add('div_vote_zero');
          else cScoreEl.classList.remove('div_vote_zero');
        }
      }
    }
  });
});
