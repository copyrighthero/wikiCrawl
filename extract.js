// Hansheng Zhao <copyrighthero@gmail.com> (https://www.zhs.me)
'use strict';

const fs = require('fs');
const leveldb = require('level');

const storage = { leveldb: [] };

const append = (filePath, content) =>
  fs.appendFileSync(filePath, content + '\n', {encoding: 'UTF8'});

void (async (sourceFilePath, targetFilePath) => {
  const titles = require(sourceFilePath);
  const ledger = [];
  const start = 110;
  const stop = 116;

  for (let index = start; index < stop; ++index) {
    storage.leveldb.push(leveldb(`${index}th.database.level`));
  }

  for (let title of titles) {
    ledger.push(title);
    for (let database of storage.leveldb) {
      try {
        append(targetFilePath, await database.get(title));
        ledger.pop();
        break;
      } catch (error) {
        continue;
      }
    }
  }

  for (let database of storage.leveldb) {
    await database.close();
  }

  return ledger;
})('./names.json', './database.json').then(ledger => {
  console.log('Process succeeded, failed for:', JSON.stringify(ledger));
  process.exit(0);
}, error => {
  console.log('Process failed:', error);
  process.exit(1);
});
