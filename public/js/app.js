window.disable_adaptive = function () {
  document.body.style.minWidth = "990px";
};

document.addEventListener("click", function (e) {
  var td = e.target.closest(".div_topic_votes_buttons td, .div_comment_votes_buttons td");
  if (!td) return;
  var ctrl = td.closest('[id^="div_vote_"]');
  if (!ctrl) return;
  var match = ctrl.id.match(/div_vote_(\d+)_(\d+)/);
  if (!match) return;
  var isTopic = match[1] === "0";
  var entityType = isTopic ? "topics" : "comments";
  var entityId = match[2];
  var isUp = td.textContent.trim() === "+";
  var value = isUp ? "up" : "down";

  fetch("/" + entityType + "/" + entityId + "/vote/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    credentials: "same-origin",
    body: "value=" + value,
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) return;
      var score = d.up - d.down;
      if (isTopic) {
        var scoreEl = ctrl.querySelector(".div_topic_votes_current nobr");
        if (scoreEl) scoreEl.textContent = score > 0 ? "+" + score : "" + score;
        var adv = ctrl.querySelector(".div_topic_votes_advanced");
        if (adv) {
          var nobs = adv.querySelectorAll("nobr");
          if (nobs[0]) nobs[0].textContent = d.up + " понравилось";
          if (nobs[1]) nobs[1].textContent = d.down + " не понравилось";
          var tds = adv.querySelectorAll("table td");
          var total = d.up + d.down;
          var upPx = total === 0 ? 0 : Math.round((d.up / total) * 120);
          var downPx = total === 0 ? 120 : 120 - upPx;
          if (tds[0]) tds[0].style.width = upPx + "px";
          if (tds[1]) tds[1].style.width = downPx + "px";
        }
      } else {
        var cur = ctrl.querySelector(".div_comment_votes_current");
        if (cur) {
          cur.textContent = score;
          cur.classList.toggle("div_vote_zero", score === 0);
        }
      }
    });
});

window.show_add_comment_form = function (commentId) {
  var form = document.getElementById("frm_new_comment");
  if (!form) {
    location.href = "/login";
    return;
  }
  var parentInput = form.querySelector('input[name="parent_id"]');
  var currentParent = parentInput ? parentInput.value : "0";
  var visible = form.style.display !== "none";

  if (commentId === 0 && currentParent === "0" && visible) {
    form.style.display = "none";
    return;
  }

  var target = document.getElementById("div_new_comment_" + commentId);
  if (!target) return;
  if (form.parentNode) form.parentNode.removeChild(form);
  if (parentInput) parentInput.value = commentId;
  target.appendChild(form);
  form.style.display = "";
  var ta = form.getElementsByTagName("textarea")[0];
  if (ta) {
    ta.focus();
    var y = ta.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo(0, y);
  }
};

document.addEventListener("submit", function (e) {
  var form = e.target;
  if (!form || form.id !== "frm_new_comment") return;
  e.preventDefault();
  var ta = form.getElementsByTagName("textarea")[0];
  if (!ta) return;
  var body = ta.value.trim();
  if (!body) return;
  var topicId = form.getAttribute("data-topic-id");
  var parentInput = form.querySelector('input[name="parent_id"]');
  var parentId = parentInput ? parentInput.value : "0";
  var url =
    "/topics/" + topicId + "/add_comment/" + (parentId && parentId !== "0" ? parentId + "/" : "");
  var submitBtn = form.querySelector("button[type=submit]");
  if (submitBtn) submitBtn.disabled = true;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    credentials: "same-origin",
    body: "body=" + encodeURIComponent(body),
  })
    .then(function (r) {
      if (r.status === 401) location.href = "/login";
      return r.json();
    })
    .then(function (d) {
      if (!d.ok) {
        if (submitBtn) submitBtn.disabled = false;
        if (d.error === "empty") return;
        return;
      }
      var home = document.getElementById("div_new_comment_0");
      if (!home) return;
      if (parentId && parentId !== "0") {
        var container = document.getElementById("div_content_comm_" + parentId);
        if (container) container.insertAdjacentHTML("beforeend", d.html);
      } else {
        var rootBox = document.getElementById("div_content_comm_0");
        if (rootBox) rootBox.insertAdjacentHTML("beforeend", d.html);
      }
      ta.value = "";
      if (form.parentNode) form.parentNode.removeChild(form);
      home.appendChild(form);
      form.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
      var cnt = document.querySelector(".div_topic_discuss_count");
      if (cnt) cnt.textContent = (parseInt(cnt.textContent, 10) || 0) + 1;
    })
    .catch(function () {
      if (submitBtn) submitBtn.disabled = false;
    });
});