// this script removes specified items from inventories and storage
import { CharParser, CharWriter } from "./char.ts";
import { StorageParser, StorageWriter } from "./storage.ts";
import { ItemDB } from "./itemdb.ts";

const args: string[] = Deno.args.slice(1);
const to_remove: Set<number> = new Set();
const char_parser = new CharParser();
const storage_parser = new StorageParser();
const char_writer = new CharWriter();
const storage_writer = new StorageWriter();
const item_db = new ItemDB();

const stats = {
    inventory: {
        removed: 0,
        pruned: 0,
        stub: 0,
        chars: 0,
    },
    storage: {
        removed: 0,
        pruned: 0,
        stub: 0,
        wiped: 0,
        synced: 0,
        accounts: 0,
    },
};

const flags = {
    dry_run: false,
};


(async () => {
    const items_by_id = new Map(); // holds full item info
    const items_by_name = new Map(); // holds references to the former

    for await (let item of item_db.readDB()) {
        items_by_id.set(+item.id, item);
        items_by_name.set(item.name, +item.id);
    }

    const itemToNumber = (name: string|number): number => {
        if (isNaN(name as number)) {
            const item_id = items_by_name.get(name);

            if (item_id) {
                return +item_id;
            } else {
                console.error(`cannot find item '${name}' in the item db`);
                throw new Error("item not found");
            }
        } else {
            return +name;
        }
    }

    const itemToString = (id: string|number): string => {
        if (isNaN(id as number)) {
            return `${id}`;
        } else {
            const item = items_by_id.get(+id);

            if (item) {
                return item.name;
            } else {
                console.error(`cannot find item ID ${id} in the item db`);
                throw new Error("item not found");
            }
        }
    }

    if (args.length < 1) {
        throw new RangeError("no items given!");
    }

    // flag parsing
    for (let opt of args) {
        if (opt.startsWith("--")) {
            switch (opt.slice(2)) {
            case "dry":
            case "dry-run":
                flags.dry_run = true;
                break;
            case "clean":
            case "clean-only":
                args.length = 0;
                break;
            default:
                throw new SyntaxError(`unknown flag: ${opt}`);
            }

            args.shift();
        }

        break; // no more flags
    }

    // item parsing
    for (let arg of args.join(",").split(",")) {
        if (arg === null || arg.length < 1)
            continue;

        if (arg.includes("-") || arg.includes("..")) {
            const range = arg.split("-").join("..").split("..");
            let from = itemToNumber(range[0]), to = itemToNumber(range[1]);

            if (from > to) {
                [from, to] = [to, from];
            }

            for (let i = from; i <= to; ++i) {
                to_remove.add(i);
            }
        } else {
            to_remove.add(itemToNumber(arg));
        }
    }

    console.info("\nThe following items will be removed:");
    for (let item of to_remove) {
        console.info(`[${item}]: ${itemToString(item)}`);
    }

    // inventory:
    for await (let char of char_parser.readDB()) {
        let items_filtered = []; // this is not a Set because some items don't stack
        let mod = false;

        for (let item of char.items) {
            if (!items_by_id.has(+item.nameid)) {
                console.log(`removing ${+item.amount || 1}x non-existant item ID ${item.nameid} from inventory of character ${char.name} [${char.account_id}:${char.char_id}]`);
                stats.inventory.pruned += +item.amount;
                mod = true;
            } else if (+item.amount < 1) {
                console.log(`removing stub of item ${itemToString(item.nameid)} [${item.nameid}] from inventory of character ${char.name} [${char.account_id}:${char.char_id}]`);
                stats.inventory.stub++;
                mod = true;
            } else if (to_remove.has(+item.nameid)) {
                console.log(`removing ${item.amount}x ${itemToString(item.nameid)} [${item.nameid}] from inventory of character ${char.name} [${char.account_id}:${char.char_id}]`);
                stats.inventory.removed += +item.amount;
                mod = true;
            } else {
                items_filtered.push(item);
            }
        }

        if (mod)
            stats.inventory.chars++;

        char.items = items_filtered;
        await char_writer.write(char);
    }

    await char_writer.finalize(!!flags.dry_run);

    // storage:
    for await (let storage of storage_parser.readDB()) {
        let items_filtered = []; // this is not a Set because some items don't stack
        let mod = false;

        for (let item of storage.items) {
            if (!items_by_id.has(+item.nameid)) {
                console.log(`removing ${+item.amount || 1}x non-existant item ID ${item.nameid} from storage of account ${storage.account_id}`);
                stats.storage.pruned += +item.amount;
                storage.storage_amount--;
                mod = true;
            } else if (+item.amount < 1) {
                console.log(`removing stub of item ${itemToString(item.nameid)} [${item.nameid}] from storage of account ${storage.account_id}`);
                stats.storage.stub++;
                storage.storage_amount--;
                mod = true;
            } else if (to_remove.has(+item.nameid)) {
                console.log(`removing ${item.amount}x ${itemToString(item.nameid)} [${item.nameid}] from storage of account ${storage.account_id}`);
                stats.storage.removed += +item.amount;
                storage.storage_amount--;
                mod = true;
            } else {
                items_filtered.push(item);
            }
        }

        if (mod)
            stats.storage.accounts++;

        storage.items = items_filtered;

        if (+storage.storage_amount !== storage.items.length) {
            const old_sync = +storage.storage_amount;
            storage.storage_amount = storage.items.length;
            console.log(`fixing sync of storage for account ${storage.account_id}: ${old_sync} => ${storage.storage_amount}`);
            stats.storage.synced++;
        }

        if (storage.storage_amount >= 1) {
            await storage_writer.write(storage);
        } else {
            console.log(`storage of account ${storage.account_id} is now empty: removing it from the storage db`);
            stats.storage.wiped++;
        }
    }

    await storage_writer.finalize(!!flags.dry_run);

    console.info("\n=== all done ===");
    console.info(`removed ${stats.inventory.removed} existant, ${stats.inventory.pruned} non-existant and ${stats.inventory.stub} stub items from the inventory of ${stats.inventory.chars} characters`);
    console.info(`removed ${stats.storage.removed} existant, ${stats.storage.pruned} non-existant and ${stats.storage.stub} stub items from the storage of ${stats.storage.accounts} accounts`);
    console.info(`removed ${stats.storage.wiped} empty storage entries from the storage db`);
    console.info(`fixed storage sync of ${stats.storage.synced} accounts`);

    if (flags.dry_run) {
        console.warn("(DRY RUN) no file modified");
    }
})()