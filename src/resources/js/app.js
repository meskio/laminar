/* laminar.js
 * frontend application for Laminar Continuous Integration
 * https://laminar.ohwg.net
 */

String.prototype.hashCode = function() {
  for(var r=0, i=0; i<this.length; i++)
    r=(r<<5)-r+this.charCodeAt(i),r&=r;
  return r;
};

Vue.filter('iecFileSize', function(bytes) {
  var exp = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, exp)).toFixed(1) + ' ' +
    ['B', 'KiB', 'MiB', 'GiB', 'TiB'][exp];
});

const timeScale = function(max){
  return max > 3600
  ? { scale:function(v){return Math.round(v/360)/10}, label:'Hours' }
  : max > 60
  ? { scale:function(v){return Math.round(v/6)/10}, label:'Minutes' }
  : { scale:function(v){return v;}, label:'Seconds' };
}
const ServerEventHandler = function() {
  function setupEventSource(to, query, next, comp) {
    const es = new EventSource(document.head.baseURI + to.path.substr(1) + query);
    es.comp = comp;
    es.path = to.path; // save for later in case we need to add query params
    es.onmessage = function(msg) {
      msg = JSON.parse(msg.data);
      // "status" is the first message the server always delivers.
      // Use this to confirm the navigation. The component is not
      // created until next() is called, so creating a reference
      // for other message types must be deferred. There are some extra
      // subtle checks here. If this eventsource already has a component,
      // then this is not the first time the status message has been
      // received. If the frontend requests an update, the status message
      // should not be handled here, but treated the same as any other
      // message. An exception is if the connection has been lost - in
      // that case we should treat this as a "first-time" status message.
      // this.comp.es is used as a proxy for this.
      if (msg.type === 'status' && (!this.comp || !this.comp.es)) {
        next(comp => {
          // Set up bidirectional reference
          // 1. needed to reference the component for other msg types
          this.comp = comp;
          // 2. needed to close the ws on navigation away
          comp.es = this;
          comp.esReconnectInterval = 500;
          // Update html and nav titles
          document.title = comp.$root.title = msg.title;
          comp.$root.version = msg.version;
          // Calculate clock offset (used by ProgressUpdater)
          comp.$root.clockSkew = msg.time - Math.floor((new Date()).getTime()/1000);
          comp.$root.connected = true;
          // Component-specific callback handler
          comp[msg.type](msg.data, to.params);
        });
      } else {
        // at this point, the component must be defined
        if (!this.comp)
          return console.error("Page component was undefined");
        else {
          this.comp.$root.connected = true;
          this.comp.$root.showNotify(msg.type, msg.data);
          if(typeof this.comp[msg.type] === 'function')
            this.comp[msg.type](msg.data);
        }
      }
    }
    es.onerror = function(e) {
      this.comp.$root.connected = false;
      setTimeout(() => {
        this.comp.es = setupEventSource(to, query, null, this.comp);
      }, this.comp.esReconnectInterval);
      if(this.comp.esReconnectInterval < 7500)
        this.comp.esReconnectInterval *= 1.5;
      this.close();
    }
    return es;
  }
  return {
    beforeRouteEnter(to, from, next) {
      setupEventSource(to, '', (fn) => { next(fn); });
    },
    beforeRouteUpdate(to, from, next) {
      this.es.close();
      setupEventSource(to, '', (fn) => { fn(this); next(); });
    },
    beforeRouteLeave(to, from, next) {
      this.es.close();
      next();
    },
    methods: {
      query(q) {
        this.es.close();
        setupEventSource(this.es.path, '?' + Object.entries(q).map(([k,v])=>`${k}=${v}`).join('&'), (fn) => { fn(this); });
      }
    }
  };
}();

const Utils = {
  methods: {
    runIcon(result) {
      return (result == 'success') ? /* checkmark */
               `<svg class="status success" viewBox="0 0 100 100">
                 <path d="m 23,46 c -6,0 -17,3 -17,11 0,8 9,30 12,32 3,2 14,5 20,-2 6,-6 24,-36
                  56,-71 5,-3 -9,-8 -23,-2 -13,6 -33,42 -41,47 -6,-3 -5,-12 -8,-15 z" />
                </svg>`
           : (result == 'failed' || result == 'aborted') ? /* cross */
               `<svg class="status failed" viewBox="0 0 100 100">
                 <path d="m 19,20 c 2,8 12,29 15,32 -5,5 -18,21 -21,26 2,3 8,15 11,18 4,-6 17,-21
                  21,-26 5,5 11,15 15,20 8,-2 15,-9 20,-15 -3,-3 -17,-18 -20,-24 3,-5 23,-26 30,-33 -3,-5 -8,-9
                  -12,-12 -6,5 -26,26 -29,30 -6,-8 -11,-15 -15,-23 -3,0 -12,5 -15,7 z" />
                </svg>`
           : (result == 'queued') ? /* clock */
                `<svg class="status queued" viewBox="0 0 100 100">
                  <circle r="50" cy="50" cx="50" />
                  <path d="m 50,15 0,35 17,17" stroke-width="10" fill="none" />
                </svg>`
           : /* spinner */
                `<svg class="status running" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" stroke-width="15" fill="none" stroke-dasharray="175">
                   <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="2s" values="0 50 50;360 50 50"></animateTransform>
                  </circle>
                 </svg>`
           ;
    },
    formatDate: function(unix) {
      // TODO: reimplement when toLocaleDateString() accepts formatting options on most browsers
      var d = new Date(1000 * unix);
      var m = d.getMinutes();
      if (m < 10) m = '0' + m;
      return d.getHours() + ':' + m + ' on ' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' +
        d.getDate() + '. ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ][d.getMonth()] + ' ' +
        d.getFullYear();
    },
    formatDuration: function(start, end) {
      if(!end)
        end = Math.floor(Date.now()/1000) + this.$root.clockSkew;
      if(end - start > 3600)
        return Math.floor((end-start)/3600) + ' hours, ' + Math.floor(((end-start)%3600)/60) + ' minutes';
      else if(end - start > 60)
        return Math.floor((end-start)/60) + ' minutes, ' + ((end-start)%60) + ' seconds';
      else
        return (end-start) + ' seconds';
    }
  }
};

const ProgressUpdater = {
  data() { return { jobsRunning: [] }; },
  methods: {
    updateProgress(o) {
      if (o.etc) {
        var p = (Math.floor(Date.now()/1000) + this.$root.clockSkew - o.started) / (o.etc - o.started);
        if (p > 1.2) {
          o.overtime = true;
        }
        if (p >= 1) {
          o.progress = 99;
        } else {
          o.progress = 100 * p;
        }
      }
    }
  },
  beforeDestroy() {
    clearInterval(this.updateTimer);
  },
  watch: {
    jobsRunning(val) {
      // this function handles several cases:
      // - the route has changed to a different run of the same job
      // - the current job has ended
      // - the current job has started (practically hard to reach)
      clearInterval(this.updateTimer);
      if (val.length) {
        // TODO: first, a non-animated progress update
        this.updateTimer = setInterval(() => {
          this.jobsRunning.forEach(this.updateProgress);
          this.$forceUpdate();
        }, 1000);
      }
    }
  }
};

const Home = function() {
  var state = {
    jobsQueued: [],
    jobsRecent: [],
    resultChanged: [],
    lowPassRates: [],
  };

  var chtUtilization, chtBuildsPerDay, chtBuildsPerJob, chtTimePerJob;

  var updateUtilization = function(busy) {
    chtUtilization.data.datasets[0].data[0] += busy ? 1 : -1;
    chtUtilization.data.datasets[0].data[1] -= busy ? 1 : -1;
    chtUtilization.update();
  }

  return {
    template: '#home',
    mixins: [ServerEventHandler, Utils, ProgressUpdater],
    data: function() {
      return state;
    },
    methods: {
      status: function(msg) {
        state.jobsQueued = msg.queued;
        state.jobsRunning = msg.running;
        state.jobsRecent = msg.recent;
        state.resultChanged = msg.resultChanged;
        state.lowPassRates = msg.lowPassRates;
        this.$forceUpdate();

        // setup charts
        chtUtilization = new Chart(document.getElementById("chartUtil"), {
          type: 'pie',
          data: {
            labels: ["Busy", "Idle"],
            datasets: [{
              data: [ msg.executorsBusy, msg.executorsTotal - msg.executorsBusy ],
              backgroundColor: ["#afa674", "#7483af"]
            }]
          },
          options: {
            hover: { mode: null }
          }
        });
        var buildsPerDayDates = function(){
          res = [];
          var now = new Date();
          for (var i = 6; i >= 0; --i) {
            var then = new Date(now.getTime() - i * 86400000);
            res.push({
              short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][then.getDay()],
              long: then.toLocaleDateString()}
            );
          }
          return res;
        }();
        chtBuildsPerDay = new Chart(document.getElementById("chartBpd"), {
          type: 'line',
          data: {
            labels: buildsPerDayDates.map((e)=>{ return e.short; }),
            datasets: [{
              label: 'Failed Builds',
              backgroundColor: "#883d3d",
              data: msg.buildsPerDay.map((e)=>{ return e.failed || 0; })
            },{
              label: 'Successful Builds',
              backgroundColor: "#74af77",
              data: msg.buildsPerDay.map((e)=>{ return e.success || 0; })
            }]
          },
          options:{
            title: { display: true, text: 'Builds per day' },
            tooltips:{callbacks:{title: function(tip, data) {
              return buildsPerDayDates[tip[0].index].long;
            }}},
            scales:{yAxes:[{
              ticks:{userCallback: (label, index, labels)=>{
                if(Number.isInteger(label))
                  return label;
              }},
              stacked: true
            }]}
          }
        });
        chtBuildsPerJob = new Chart(document.getElementById("chartBpj"), {
          type: 'horizontalBar',
          data: {
            labels: Object.keys(msg.buildsPerJob),
            datasets: [{
              label: 'Runs in last 24 hours',
              backgroundColor: "#7483af",
              data: Object.keys(msg.buildsPerJob).map((e)=>{ return msg.buildsPerJob[e]; })
            }]
          },
          options:{
            title: { display: true, text: 'Builds per job' },
            hover: { mode: null },
            scales:{xAxes:[{ticks:{userCallback: (label, index, labels)=>{
              if(Number.isInteger(label))
                return label;
            }}}]}
          }
        });
        var tpjScale = timeScale(Math.max(...Object.values(msg.timePerJob)));
        chtTimePerJob = new Chart(document.getElementById("chartTpj"), {
          type: 'horizontalBar',
          data: {
            labels: Object.keys(msg.timePerJob),
            datasets: [{
              label: 'Mean run time this week',
              backgroundColor: "#7483af",
              data: Object.keys(msg.timePerJob).map((e)=>{ return msg.timePerJob[e]; })
            }]
          },
          options:{
            title: { display: true, text: 'Mean run time this week' },
            hover: { mode: null },
            scales:{xAxes:[{
              ticks:{userCallback: tpjScale.scale},
              scaleLabel: {
                display: true,
                labelString: tpjScale.label
              }
            }]},
            tooltips:{callbacks:{label:(tip, data)=>{
              return data.datasets[tip.datasetIndex].label + ': ' + tip.xLabel + ' ' + tpjScale.label.toLowerCase();
            }}}
          }
        });
        const btcScale = timeScale(Math.max(...msg.buildTimeChanges.map(e=>Math.max(...e.durations))));
        var chtBuildTimeChanges = new Chart(document.getElementById("chartBuildTimeChanges"), {
          type: 'line',
          data: {
            labels: [...Array(10).keys()],
            datasets: msg.buildTimeChanges.map((e)=>{return {
              label: e.name,
              data: e.durations,
              borderColor: 'hsl('+(e.name.hashCode() % 360)+', 27%, 57%)',
              backgroundColor: 'transparent'
            }})
          },
          options:{
            title: { display: true, text: 'Build time changes' },
            legend:{ display: true, position: 'bottom' },
            scales:{
              xAxes:[{ticks:{display: false}}],
              yAxes:[{
                ticks:{userCallback: btcScale.scale},
                scaleLabel: {
                  display: true,
                  labelString: btcScale.label
                }
              }]
            },
            tooltips:{
              enabled:false
            }
          }
        });
      },
      job_queued: function(data) {
        state.jobsQueued.splice(0, 0, data);
        this.$forceUpdate();
      },
      job_started: function(data) {
        state.jobsQueued.splice(state.jobsQueued.length - data.queueIndex - 1, 1);
        state.jobsRunning.splice(0, 0, data);
        this.$forceUpdate();
        updateUtilization(true);
      },
      job_completed: function(data) {
        if (data.result === "success")
          chtBuildsPerDay.data.datasets[0].data[6]++;
        else
          chtBuildsPerDay.data.datasets[1].data[6]++;
        chtBuildsPerDay.update();

        for (var i = 0; i < state.jobsRunning.length; ++i) {
          var job = state.jobsRunning[i];
          if (job.name == data.name && job.number == data.number) {
            state.jobsRunning.splice(i, 1);
            state.jobsRecent.splice(0, 0, data);
            this.$forceUpdate();
            break;
          }
        }
        updateUtilization(false);
        for (var j = 0; j < chtBuildsPerJob.data.datasets[0].data.length; ++j) {
          if (chtBuildsPerJob.data.labels[j] == job.name) {
            chtBuildsPerJob.data.datasets[0].data[j]++;
            chtBuildsPerJob.update();
            break;
          }
        }
      }
    }
  };
}();

const All = function(templateId) {
  var state = {
    jobs: [],
    search: '',
    groups: {},
    regexps: {},
    group: null,
    ungrouped: []
  };
  return {
    template: templateId,
    mixins: [ServerEventHandler, Utils, ProgressUpdater],
    data: function() { return state; },
    methods: {
      status: function(msg) {
        state.jobs = msg.jobs;
        state.jobsRunning = msg.running;
        // mix running and completed jobs
        for (var i in msg.running) {
          var idx = state.jobs.findIndex(job => job.name === msg.running[i].name);
          if (idx > -1)
            state.jobs[idx] = msg.running[i];
          else {
            // special case: first run of a job.
            state.jobs.unshift(msg.running[i]);
            state.jobs.sort(function(a, b){return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;});
          }
        }
        state.groups = {};
        Object.keys(msg.groups).forEach(k => state.regexps[k] = new RegExp(state.groups[k] = msg.groups[k]));
        state.ungrouped = state.jobs.filter(j => !Object.values(state.regexps).some(r => r.test(j.name))).map(j => j.name);
        state.group = state.ungrouped.length ? null : Object.keys(state.groups)[0];
      },
      job_started: function(data) {
        data.result = 'running'; // for wallboard css
        var updAt = null;
        // jobsRunning must be maintained for ProgressUpdater
        for (var i in state.jobsRunning) {
          if (state.jobsRunning[i].name === data.name) {
            updAt = i;
            break;
          }
        }
        if (updAt === null) {
          state.jobsRunning.unshift(data);
        } else {
          state.jobsRunning[updAt] = data;
        }
        updAt = null;
        for (var i in state.jobs) {
          if (state.jobs[i].name === data.name) {
            updAt = i;
            break;
          }
        }
        if (updAt === null) {
          // first execution of new job. TODO insert without resort
          state.jobs.unshift(data);
          state.jobs.sort(function(a, b){return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;});
          if(!Object.values(state.regexps).some(r => r.test(data.name)))
              state.ungrouped.push(data.name);
        } else {
          state.jobs[updAt] = data;
        }
        this.$forceUpdate();
      },
      job_completed: function(data) {
        for (var i in state.jobs) {
          if (state.jobs[i].name === data.name) {
            state.jobs[i] = data;
            // forceUpdate in second loop
            break;
          }
        }
        for (var i in state.jobsRunning) {
          if (state.jobsRunning[i].name === data.name) {
            state.jobsRunning.splice(i, 1);
            this.$forceUpdate();
            break;
          }
        }
      },
      filteredJobs: function() {
        let ret = [];
        if (state.group)
          ret = state.jobs.filter(job => state.regexps[state.group].test(job.name));
        else
          ret = state.jobs.filter(job => state.ungrouped.includes(job.name));
        if (this.search)
          ret = ret.filter(job => job.name.indexOf(this.search) > -1);
        return ret;
      },
      wallboardJobs: function() {
        let ret = [];
        const expr = (new URLSearchParams(window.location.search)).get('filter');
        if (expr)
          ret = state.jobs.filter(job => (new RegExp(expr)).test(job.name));
        else
          ret = state.jobs;
        // sort failed before success, newest first
        ret.sort((a,b) => a.result == b.result ? a.started - b.started : 2*(b.result == 'success')-1);
        return ret;
      },
      wallboardLink: function() {
        return '/wallboard' + (state.group ? '?filter=' + state.groups[state.group] : '');
      }
    }
  };
};

var Job = function() {
  var state = {
    description: '',
    jobsRunning: [],
    jobsRecent: [],
    lastSuccess: null,
    lastFailed: null,
    nQueued: 0,
    pages: 0,
    sort: {}
  };
  var chtBt = null;
  return Vue.extend({
    template: '#job',
    mixins: [ServerEventHandler, Utils, ProgressUpdater],
    data: function() {
      return state;
    },
    methods: {
      status: function(msg) {
        state.description = msg.description;
        state.jobsRunning = msg.running;
        state.jobsRecent = msg.recent;
        state.lastSuccess = msg.lastSuccess;
        state.lastFailed = msg.lastFailed;
        state.nQueued = msg.nQueued;
        state.pages = msg.pages;
        state.sort = msg.sort;

        // "status" comes again if we change page/sorting. Delete the
        // old chart and recreate it to prevent flickering of old data
        if(chtBt)
          chtBt.destroy();
        const btScale = timeScale(Math.max(...msg.recent.map(v=>v.completed-v.started)));
        chtBt = new Chart(document.getElementById("chartBt"), {
          type: 'bar',
          data: {
            labels: msg.recent.map(function(e) {
              return '#' + e.number;
            }).reverse(),
            datasets: [{
              label: 'Average',
              type: 'line',
              data: [{x:0,y:msg.averageRuntime},{x:1,y:msg.averageRuntime}],
              borderColor: '#7483af',
              backgroundColor: 'transparent',
              xAxisID: 'avg',
              pointRadius: 0,
              pointHitRadius: 0,
              pointHoverRadius: 0,
            },{
              label: 'Build time',
              backgroundColor: msg.recent.map(e => e.result == 'success' ? '#74af77': '#883d3d').reverse(),
              data: msg.recent.map(function(e) {
                return e.completed - e.started;
              }).reverse()
            }]
          },
          options: {
            title: { display: true, text: 'Build time' },
            hover: { mode: null },
            scales:{
              xAxes:[{
                categoryPercentage: 1.0,
                barPercentage: 1.0
              },{
                id: 'avg',
                type: 'linear',
                ticks: {
                  display: false
                },
                gridLines: {
                  display: false,
                  drawBorder: false
                }
              }],
              yAxes:[{
                ticks:{userCallback: btScale.scale},
                scaleLabel:{display: true, labelString: btScale.label}
              }]
            },
            tooltips:{callbacks:{label:(tip, data)=>{
              return data.datasets[tip.datasetIndex].label + ': ' + tip.yLabel + ' ' + btScale.label.toLowerCase();
            }}}
          }
        });
      },
      job_queued: function() {
        state.nQueued++;
      },
      job_started: function(data) {
        state.nQueued--;
        state.jobsRunning.splice(0, 0, data);
        this.$forceUpdate();
      },
      job_completed: function(data) {
        for (var i = 0; i < state.jobsRunning.length; ++i) {
          var job = state.jobsRunning[i];
          if (job.number === data.number) {
            state.jobsRunning.splice(i, 1);
            state.jobsRecent.splice(0, 0, data);
            this.$forceUpdate();
            // TODO: update the chart
            break;
          }
        }
      },
      page_next: function() {
        state.sort.page++;
        this.query(state.sort)
      },
      page_prev: function() {
        state.sort.page--;
        this.query(state.sort)
      },
      do_sort: function(field) {
        if(state.sort.field == field) {
          state.sort.order = state.sort.order == 'asc' ? 'dsc' : 'asc';
        } else {
          state.sort.order = 'dsc';
          state.sort.field = field;
        }
        this.query(state.sort)
      }
    }
  });
}();

const Run = function() {
  const utf8decoder = new TextDecoder('utf-8');
  var state = {
    job: { artifacts: [], upstream: {} },
    latestNum: null,
    log: '',
  };
  const logFetcher = (vm, name, num) => {
    const abort = new AbortController();
    fetch('log/'+name+'/'+num, {signal:abort.signal}).then(res => {
      // ATOW pipeThrough not supported in Firefox
      //const reader = res.body.pipeThrough(new TextDecoderStream).getReader();
      const reader = res.body.getReader();
      let total = 0;
      return function pump() {
        return reader.read().then(({done, value}) => {
          value = utf8decoder.decode(value);
          if (done)
            return;
          state.log += ansi_up.ansi_to_html(value.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\033\[\{([^:]+):(\d+)\033\\/g, (m,$1,$2)=>{return '<a href="jobs/'+$1+'" onclick="return vroute(this);">'+$1+'</a>:<a href="jobs/'+$1+'/'+$2+'" onclick="return vroute(this);">#'+$2+'</a>';}));
          vm.$forceUpdate();
          return pump();
        });
      }();
    }).catch(e => {});
    return abort;
  }

  return {
    template: '#run',
    mixins: [ServerEventHandler, Utils, ProgressUpdater],
    data: function() {
      return state;
    },
    methods: {
      status: function(data, params) {
        // Check for the /latest endpoint
        if(params.number === 'latest')
          return this.$router.replace('/jobs/' + params.name + '/' + data.latestNum);

        state.number = parseInt(params.number);
        state.jobsRunning = [];
        state.job = data;
        state.latestNum = data.latestNum;
        state.jobsRunning = [data];
        state.log = '';
        if(this.logstream)
          this.logstream.abort();
        if(data.started)
          this.logstream = logFetcher(this, params.name, params.number);
      },
      job_queued: function(data) {
        state.latestNum = data.number;
        this.$forceUpdate();
      },
      job_started: function(data) {
        if(data.number === state.number) {
          state.job = Object.assign(state.job, data);
          state.job.result = 'running';
          if(this.logstream)
            this.logstream.abort();
          this.logstream = logFetcher(this, data.name, data.number);
          this.$forceUpdate();
        }
      },
      job_completed: function(data) {
        if(data.number === state.number) {
          state.job = Object.assign(state.job, data);
          state.jobsRunning = [];
          this.$forceUpdate();
        }
      },
      runComplete: function(run) {
        return !!run && (run.result === 'aborted' || run.result === 'failed' || run.result === 'success');
      },
    }
  };
}();

// For all charts, set miniumum Y to 0
Chart.scaleService.updateScaleDefaults('linear', {
    ticks: { suggestedMin: 0 }
});
// Don't display legend by default
Chart.defaults.global.legend.display = false;
// Disable tooltip hover animations
Chart.defaults.global.hover.animationDuration = 0;
// Plugin to move a DOM item on top of a chart element
Chart.plugins.register({
  afterDatasetsDraw: (chart) => {
    chart.data.datasets.forEach((dataset, i) => {
      var meta = chart.getDatasetMeta(i);
      if(dataset.itemid)
        meta.data.forEach((e,j) => {
          var pos = e.getCenterPoint();
          var node = document.getElementById(dataset.itemid[j]);
          node.style.top = (pos.y - node.clientHeight/2) + 'px';
        });
    });
  }
});

new Vue({
  el: '#app',
  data: {
    title: '', // populated by status ws message
    version: '',
    clockSkew: 0,
    connected: false,
    notify: 'localStorage' in window && localStorage.getItem('showNotifications') == 1
  },
  computed: {
    supportsNotifications() {
      return 'Notification' in window && Notification.permission !== 'denied';
    }
  },
  methods: {
    toggleNotifications(en) {
      if(Notification.permission !== 'granted')
        Notification.requestPermission(p => this.notify = (p === 'granted'))
      else
        this.notify = en;
    },
    showNotify(msg, data) {
      if(this.notify && msg === 'job_completed')
        new Notification('Job ' + data.result, {
          body: data.name + ' ' + '#' + data.number + ': ' + data.result
        });
    },
    runIcon: Utils.methods.runIcon
  },
  watch: {
    notify(e) { localStorage.setItem('showNotifications', e ? 1 : 0); }
  },
  router: new VueRouter({
    mode: 'history',
    base: document.head.baseURI.substr(location.origin.length),
    routes: [
      { path: '/',                   component: Home },
      { path: '/jobs',               component: All('#jobs') },
      { path: '/wallboard',          component: All('#wallboard') },
      { path: '/jobs/:name',         component: Job },
      { path: '/jobs/:name/:number', component: Run }
    ],
  }),
});
