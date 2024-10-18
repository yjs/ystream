
# Y/stream

A *unique* attempt to create a multi-master eventual consistent database that
syncs many CRDTs (e.g. Yjs documents) efficiently.

- network agnostic
- works everywhere (browser, node, ..)
- small footprint
- documents can have "capabilities" that can be synced with a filesystem.
- syncs __many__ documents efficiently
- Auth* integrated
- (experimental software)

### Demos
#### Sync collection to filesystem
- run `./bin/yfs.js --init dir --collection my-collection-name` to sync `dir` to
  a collection.
- run `./bin/yfs.js --clone clone --collection my-collection-name` to clone
  collection state to a filesystem
- The different directories are now synced. If you open a file in one directory,
  it will sync the changes to the other directory. This even works on different
  computers. DONT SHARE SENSITIVE DATA!

#### Sync collection to a browser application for real-time editing of the files
- `cd demo`
- Open `demo/src/app/ystream.tsx` and change the variable `collectionName`:
`const collectionName = 'my-collection-name'`
- `npm run dev`
- open [demo]{http://localhost:3000}
- You can run this demo in combination with the file-system demo to see
filesystem and editor state synced in real-time.

### Work with me

This project is still in the early stages. I'm looking for a company that wants
to sponsor this work and integrate it in their product. Contact me
<kevin.jahns@pm.me>.

