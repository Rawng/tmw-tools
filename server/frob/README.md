# tmwAthena item frobber
## Prerequisites
- [Deno] `v0.X`
    - must be in your `$PATH`

## Compatibility
- works with tmwAthena `v16.2.9 - v19.4.15`
    - newer versions may modify the flatfile structure and break the regexes

## Usage
- from `tmwa-server-data`:
```sh
# choose whatever syntax you prefer:
make frob items="item[,item[,item...]]"     # item list (csv)
make frob items="item[ item[ item...]]"     # item list
make frob items="item-item"                 # item range
make frob items="item..item"                # item range
make frob items="item,item item-item item"  # mixed
```

[Deno]: https://deno.land
