FROM node:7

RUN mkdir -p /usr/node_app
COPY . /usr/node_app
WORKDIR /usr/node_app

RUN apt-get update; \
    apt-get install -y git

RUN npm install --production

RUN apt-get -y remove build-essential; \
    apt -y autoremove; \
    apt-get clean

CMD ["npm", "start"]
