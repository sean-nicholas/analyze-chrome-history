const fs = require('fs');
const _ = require('lodash');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./History');

function all(query) {
  return new Promise((res, rej) => {
    db.all(query, function(err, data) {
      if (err) return rej(err);
      res(data);
    });
  });
}

function createVisitDates() {
  return all(`
    CREATE TEMP VIEW 'visit_dates' AS
    SELECT 
      v.id, u.url, 
      datetime(v.visit_time/1000000-11644473600,'unixepoch','localtime') as visit_date, 
      v.visit_time,
      v.visit_duration,
      datetime((v.visit_time + v.visit_duration)/1000000-11644473600,'unixepoch','localtime') as visit_end, 
      u.visit_count
    FROM visits as v left join urls as u on v.url = u.id
    ORDER BY v.visit_time
  `);
}

function createWakeSleep() {
  return all(`
    CREATE TEMP VIEW 'wake_sleep' AS 
    SELECT 
        b0613.visit_date as wake_up,
        IFNULL(b0006.visit_date, max.visit_date) as go_sleep, 
        IFNULL(b0006.visit_time, max.visit_time) - b0613.visit_time AS duration
    FROM (
        SELECT 
            *
        FROM visit_dates WHERE id IN (
            SELECT id FROM (
              SELECT min(visit_time), id
              FROM visit_dates
              WHERE time(visit_date) BETWEEN '06:00:00' AND '20:00:00'
              GROUP BY date(visit_date)
          )
        )
        ORDER BY id DESC
    ) AS b0613 
    LEFT JOIN (
        SELECT 
            *
        FROM visit_dates WHERE id IN (
          SELECT id FROM (
            SELECT max(visit_time), id
            FROM visit_dates
            GROUP BY date(visit_date)
          )
        )
        ORDER BY id DESC
    ) AS max ON date(b0613.visit_date) = date(max.visit_date)
    LEFT JOIN (
        SELECT 
            *
        FROM visit_dates WHERE id IN (
            SELECT id FROM (
              SELECT min(visit_time), id
              FROM visit_dates
              WHERE time(visit_date) BETWEEN '00:00:00' AND '06:00:00'
              GROUP BY date(visit_date)
          )
        )
        ORDER BY id DESC
    ) AS b0006 ON date(b0613.visit_date, '1 days') = date(b0006.visit_date)
  `);
}

createVisitDates()
  .then(createWakeSleep)
  .then(() => {
    return Promise.all([
      all(`SELECT date(wake_up) AS date, duration FROM wake_sleep`)
        .then(data => {
          return _.transform(data, (result, date) => {
            const key = (new Date(date.date)).getTime() / 1000;
            result[key] = parseFloat((date.duration / (60 * 60 * 1000000)).toFixed(2))
          }, {});
        }),
      all(`
        SELECT 
          date(w.wake_up) AS date, 
          w.duration AS duration, 
          count(w.wake_up) AS sites_visited
        FROM wake_sleep AS w
        LEFT JOIN visit_dates AS v
          ON v.visit_date BETWEEN w.wake_up AND w.go_sleep
        GROUP BY date`)
        .then(data => {
          return _.transform(data, (result, date) => {
            const key = (new Date(date.date)).getTime() / 1000;
            result[key] = date.sites_visited
          }, {});
        }),
      all(`
        SELECT 
          date(w.wake_up) AS date, 
          w.duration AS duration, 
          count(w.wake_up) AS sites_visited
        FROM wake_sleep AS w
        LEFT JOIN visit_dates AS v
          ON v.visit_date BETWEEN w.wake_up AND w.go_sleep
        GROUP BY date`)
        .then(data => {
          return _.transform(data, (result, date) => {
            const key = (new Date(date.date)).getTime() / 1000;
            result[key] = parseFloat((date.sites_visited / (date.duration / (60 * 60 * 1000000))).toFixed(2))
          }, {});
        })
    ]);
  })
  .then(data => {
    const [upDownDuration, sitesPerDay, sitesPerDayPerHour] = data;
    const template = fs.readFileSync('./charts.template.html');
    const compiled = _.template(template);
    return compiled({
      upDownDuration: JSON.stringify(upDownDuration),
      sitesPerDay: JSON.stringify(sitesPerDay),
      sitesPerDayPerHour: JSON.stringify(sitesPerDayPerHour)
    });
  })
  .then(html => {
    fs.writeFileSync('./reports/charts.html', html);
  })
  .catch(console.log)