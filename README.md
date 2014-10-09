# apostrophe-patch

Utility tasks for importing and, eventually, exporting part or all of the content of an A2 site as files in JSON format.

## Usage

```
node app apostrophe:patch patchfile.json
```

Currently a patchfile is created by [apostropheA2ExportPlugin](http://trac.apostrophenow.org/wiki/A2MigrationGuide) as a way of moving content from A1.5 to A2. However we anticipate adding tasks to export patchfiles from A2 sites as well.

*Note:* your patchfile is usually accompanied by a folder of media files, which you can merge with your website's current media files just by copying them into `public/uploads/files`.
