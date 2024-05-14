import { TelegramClient, Api } from 'telegram';
import input from 'input';
import * as fs from 'fs';
import { NewMessageEvent } from 'telegram/events';
import { Dialog } from 'telegram/tl/custom/dialog';
import natural from 'natural';
import { StringSession } from 'telegram/sessions/index.js';

const APP_ID = parseInt(process.env.APP_ID || '');
const API_HASH = process.env.API_HASH;
let client: TelegramClient;
let dialog: Dialog;

const data: {
    stopWords: {
        [key: string]: number;
    };
    banCounter: number;
    restart: number;
    restrictedLetters: {
        [key: string]: number;
    };
} = {
    stopWords: {},
    banCounter: 0,
    restart: 0,
    restrictedLetters: {},
};

const loadData = () => {
    try {
        const savedData = JSON.parse(fs.readFileSync('./persist.json', 'utf-8'));
        Object.keys(data).forEach(key => {
            if (key in savedData) data[key] = savedData[key];
        });
    } catch {
        console.error('data not persisted');
    }
};

const saveData = () => {
    fs.writeFileSync('./persist.json', JSON.stringify(data, null, 2));
};

const initializeClient = async (): Promise<TelegramClient> => {
    if (!APP_ID) throw new Error('!process.env.APP_ID');
    if (!API_HASH) throw new Error('!process.env.API_HASH');

    const stringSession = fs.readFileSync('./.session', {
        encoding: 'utf-8',
    });

    client = new TelegramClient(new StringSession(stringSession), APP_ID, API_HASH, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('Please enter your number: '),
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: err => console.log(err),
    });

    const stringSessionNew: string = client.session.save() as unknown as string;

    fs.writeFileSync('./.session', stringSessionNew, 'utf-8');

    loadData();
    data.restart++;
    setInterval(saveData, 10000);

    return client;
};

const checkRestrictedLetters = (message: string): string | undefined => {
    const stopLetters: string[] = [];

    message.split('').forEach(letter => {
        if (letter in data.restrictedLetters) {
            if (!stopLetters.includes(letter)) {
                stopLetters.push(letter);
                data.restrictedLetters[letter]++;
            }
        }
    });

    if (stopLetters.length) return `запрещенные буквы (${stopLetters.join(', ')})`;
};

const checkRestrictedWords = (message: string): string | undefined => {
    const stopWords: string[] = [];

    natural.PorterStemmerRu.tokenizeAndStem(message).forEach(stemmedWord => {
        console.log(stemmedWord, data.stopWords);
        if (stemmedWord in data.stopWords) {
            stopWords.push(stemmedWord);
            data.stopWords[stemmedWord]++;
        }
    });

    if (stopWords.length) return `запрещенные слова (${stopWords.join(', ')})`;
};

const checkRestrictedMixes = (message: string): string | undefined => {
    const mixedWord = natural.PorterStemmerRu.tokenizeAndStem(message).find(
        word => /[A-z]/.test(word) && /[А-я]/.test(word),
    );

    if (mixedWord) return `смешение латиницы и кириллицы в слове "${mixedWord}"`;
};

initializeClient().then(async client => {
    client.addEventHandler(async (event: NewMessageEvent) => {
        if (event instanceof Api.UpdateNewChannelMessage) {
            if (event.message instanceof Api.MessageEmpty) return;

            console.log(`UpdateNewChannelMessage`);

            const admins = await getAdmins();

            // @ts-ignore
            const senderId = event.message.fromId?.userId;

            if (senderId) {
                const admin = admins.find(
                    admin => senderId && admin.id.valueOf() === senderId.valueOf(),
                );

                if (admin) {
                    const match1 = event.message.message.match(
                        /Добавить стоп-слово ([A-zА-я ,]+)/,
                    )?.[1];
                    console.log({ match1 });
                    if (match1) return addStopWords(match1.split(','));

                    const match2 = event.message.message.match(
                        /Убрать стоп-слово ([A-zА-я ,]+)/,
                    )?.[1];
                    console.log({ match2 });
                    if (match2) return removeStopWords(match2.split(','));

                    if (event.message.message === 'Хит-парад') return showTopStopWords();
                }
            }

            let reason =
                checkRestrictedLetters(event.message.message) ||
                checkRestrictedWords(event.message.message) ||
                checkRestrictedMixes(event.message.message);

            if (reason) {
                const result = await client.invoke(
                    new Api.messages.Search({
                        peer: dialog.id,
                        fromId: event.message.fromId,
                        q: '',
                        filter: new Api.InputMessagesFilterEmpty(),
                    }),
                );

                //@ts-ignore
                const count: string | number = result.count || '---';

                console.log({
                    message: event.message.message,
                    reason,
                    count,
                });

                if (typeof count === 'number' && count > 10) return;

                console.log(`Сообщение будет удалено`);

                data.banCounter++;

                const message = `Сообщение удалено за ${reason}. Кол-во сообщений от пользователя ${count}`;

                client.deleteMessages(dialog.id, [event.message.id], {
                    revoke: true,
                });

                const message2 = await client.sendMessage(dialog.id!, {
                    message,
                    silent: true,
                });

                setTimeout(() => {
                    message2.delete();
                }, 60 * 1000);
            }
        } else if (event instanceof Api.UpdateUserStatus) {
            console.log(`UpdateUserStatus`);
        } else {
            Object.entries(Api).forEach((key, value) => {
                if (typeof value === 'function' && event instanceof value)
                    console.log(`instanceof ${key}`);
            });
        }
    });

    const dialogs = await client.getDialogs();

    dialog = dialogs.find(x => x.name === 'МойСклад API: сообщество разработчиков')!;

    const admins = await getAdmins();
});

let admins: Api.User[] = [];

const getAdmins = async () => {
    if (admins.length) return admins;
    admins = await client.getParticipants(dialog.id!, {
        filter: new Api.ChannelParticipantsAdmins(),
        limit: 100,
        offset: 0,
    });
    return admins;
};

const addStopWords = async (words: string[]) => {
    if (!words.length) return;

    const addedWords: string[] = [];
    const existedWords: string[] = [];

    words.forEach(word => {
        word = word.trim();

        const stemmedWord = natural.PorterStemmerRu.stem(word);
        if (stemmedWord in data.stopWords) {
            existedWords.push(word);
        } else {
            addedWords.push(word);
            data.stopWords[stemmedWord] = 0;
        }
    });

    const existedWordsMessage = existedWords.length
        ? `В стоп-лист добавлены слова: ${existedWords.join(', ')}`
        : '';
    const addedWordsMessage = addedWords.length
        ? `В стоп-лист добавлены слова: ${addedWords.join(', ')}`
        : '';

    client.sendMessage(dialog.id!, {
        message: [existedWordsMessage, addedWordsMessage].join('\n'),
        silent: true,
    });
};

const removeStopWords = async (words: string[]) => {
    if (!words.length) return;

    const removedWords: string[] = [];
    const notExistedWords: string[] = [];

    words.forEach(word => {
        word = word.trim();

        const stemmedWord = natural.PorterStemmerRu.stem(word);
        if (stemmedWord in data.stopWords) {
            delete data[stemmedWord];
            removedWords.push(word);
        } else {
            notExistedWords.push(word);
        }
    });

    const notExistedWordsMessage = notExistedWords.length
        ? `В стоп-листе не найдены слова: ${notExistedWords.join(', ')}`
        : '';
    const removedWordsMessage = removedWords.length
        ? `Из стоп-листа убраны слова: ${removedWords.join(', ')}`
        : '';

    client.sendMessage(dialog.id!, {
        message: [notExistedWordsMessage, removedWordsMessage].join('\n'),
        silent: true,
    });
};

const showTopStopWords = () => {
    let entries = Object.entries(data.stopWords);

    entries = entries.filter(x => x[1] > 0);
    entries.sort((a, b) => b[1] - a[1]);

    entries = entries.slice(0, 10);
    let message = `Всего удалено сообщений: ${data.banCounter}\n`;
    message += `Хит-парад стоп-слов:\n`;

    entries.forEach(([word, quantity], index) => {
        message += `${word} — ${quantity}\n`;
    });

    client.sendMessage(dialog.id!, {
        message,
        silent: true,
    });
};
