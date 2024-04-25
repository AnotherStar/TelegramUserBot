import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import input from 'input'; // npm i input
import * as fs from 'fs';
import { EntityLike } from 'telegram/define';
import { NewMessage, NewMessageEvent, Raw } from 'telegram/events';
import { Dialog } from 'telegram/tl/custom/dialog';
import { dialogs } from 'telegram/client';
import natural from 'natural';

const APP_ID = parseInt(process.env.APP_ID || '');
const API_HASH = process.env.API_HASH;
let client: TelegramClient;
let dialog: Dialog;

const data = { stopWords: [], banCounter: 0, restart: 0, restrictedLetters: [] };

const loadData = () => {
    try {
        const savedData = JSON.parse(fs.readFileSync('persist', 'utf-8'));
        Object.keys(data).forEach(key => {
            if (key in savedData) data[key] = savedData[key];
        });
    } catch {}
};

const saveData = () => {
    fs.writeFileSync('persist', JSON.stringify(data, null, 2));
};

const initializeClient = async (): Promise<TelegramClient> => {
    if (!APP_ID) throw new Error('!process.env.APP_ID');
    if (!API_HASH) throw new Error('!process.env.API_HASH');

    const stringSession = fs.readFileSync('./session', {
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

    const stringSessionNew: string = client.session.save();
    fs.writeFileSync('./session', stringSessionNew, 'utf-8');

    loadData();
    data.restart++;
    console.log(data);
    setInterval(saveData, 1000);

    // client.invoke(
    //     new Api.messages.DeleteMessages({
    //         id: [event.message.id],

    //     }),
    // );

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

                // if (result.count > 10) return;

                data.banCounter++;
                const message = `Сообщение удалено за ${reason}. Кол-во сообщений от пользователя ${result.count}`;

                client.deleteMessages(dialog.id, [event.message.id], {
                    revoke: true,
                });

                client.sendMessage(dialog.id!, {
                    message,
                    silent: true,
                });
            }
        } else if (event instanceof Api.UpdateUserStatus) {
            console.log(`UpdateUserStatus`);
        } else {
            Object.entries(Api).forEach((key, value) => {
                if (typeof value === 'function' && event instanceof value)
                    console.log(`instanceof ${key}`);
            });
            // console.log(`unknown`, event);
        }
        // fs.writeFileSync('./log', '\n' + JSON.stringify(event, null, 2), {
        //     flag: 'a+',
        // });
        // Use the args from event.message.patternMatch..
        // await event.message.reply({ text: "Thanks, registered!" });
    });

    const dialogs = await client.getDialogs();

    dialog = dialogs.find(x => x.name === 'МойСклад API: сообщество разработчиков')!;

    // const result = await client.invoke<Api.messages.Search>(
    //     new Api.messages.Search({
    //         peer: dialog.id,
    //         fromId: 'another_star',
    //         q: '',
    //         filter: new Api.InputMessagesFilterEmpty(),
    //     }),
    // );

    // console.log(result);

    // const result = await client.invoke(
    //     new Api.messages.GetHistory({
    //         peer: dialog.id,
    //         //   offsetId: 43,
    //         //   offsetDate: 43,
    //         addOffset: 24900,
    //         limit: 1,
    //         //   maxId: 0,
    //         //   minId: 0,
    //     }),
    // );

    // console.log(result);
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

// const stringSessionOld = fs.readFileSync('./session', {
//     encoding: 'utf-8',
// });

// (async () => {

//     await client.start({
//         phoneNumber: async () => await input.text('Please enter your number: '),
//         password: async () => await input.text('Please enter your password: '),
//         phoneCode: async () => await input.text('Please enter the code you received: '),
//         onError: err => console.log(err),
//     });

//     console.log('You should now be connected.');

//     const stringSessionNew: string = client.session.save();

//     console.log({ stringSessionNew });

//     fs.writeFileSync('./session', stringSessionNew, 'utf-8');

//     await client.sendMessage('me', { message: 'Hello!' });
// })();
