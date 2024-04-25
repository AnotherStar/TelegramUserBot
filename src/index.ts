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

const data = { stopWords: [], banCounter: 0, restart: 0, restrictedLetters: [] };

const loadData = () => {
    try {
        const savedData = JSON.parse(fs.readFileSync('./.persist', 'utf-8'));
        Object.keys(data).forEach(key => {
            if (key in savedData) data[key] = savedData[key];
        });
    } catch {}
};

const saveData = () => {
    fs.writeFileSync('./.persist', JSON.stringify(data, null, 2));
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

    data.restrictedLetters.forEach(letter => {
        if (message.includes(letter)) stopLetters.push(letter);
    });

    if (stopLetters.length) return `запрещенные буквы (${stopLetters.join(', ')})`;
};

const checkRestrictedWords = (message: string): string | undefined => {
    const stemmedStopWords = data.stopWords.map(natural.PorterStemmerRu.stem);

    const stopWords: string[] = [];

    natural.PorterStemmerRu.tokenizeAndStem(message).forEach(word => {
        stemmedStopWords.forEach((stopWord, stopWordsIndex) => {
            if (word === stopWord) stopWords.push(data.stopWords[stopWordsIndex]);
        });

        console.log(word);
    });

    if (stopWords.length) return `запрещенные слова (${stopWords.join(', ')})`;
};

initializeClient().then(async client => {
    client.addEventHandler(async (event: NewMessageEvent) => {
        if (event instanceof Api.UpdateNewChannelMessage) {
            if (event.message instanceof Api.MessageEmpty) return;

            console.log(`UpdateNewChannelMessage`);

            let reason =
                checkRestrictedLetters(event.message.message) ||
                checkRestrictedWords(event.message.message);

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
});

const sendMessage = async (message: string) => {
    const result = await client.invoke(
        new Api.messages.SendMessage({
            message,
            peer: dialog.id,
            silent: true,
        }),
    );
};
