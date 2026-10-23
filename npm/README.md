# zebraapp

Label designer for Zebra and other ZPL printers (Word-style editor, Bluetooth LE, network, USB, serial).

```sh
npx zebraapp
# or
npm install -g zebraapp && zebraapp
```

On the first run this downloads the ZebraApp app for your system from the project's GitHub release
(Windows x64/ARM64, macOS Apple silicon/Intel, Linux x86_64/ARM64), checks its SHA-256 against the
`SHA256SUMS.txt` of that release and keeps it in a cache folder. Later runs start immediately.

Source, documentation and downloads: <https://github.com/TroubledKezoo1/ZebraDesignApp>
