const route = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const multer = require('multer');

const User = require('../models/userModel');
const Post = require('../models/postModel');
const env = require('../environment/index');
const sendMail = require('../mail');
const uploadMiddleware = require('../upload');
const codeOfConfirm = require('../mail/confirm');


const generateToken = (params = {}, cb) => {
  /**
   * Generate token recebe o id do usúario como identificações futuruas ao token
   * recebe uma callback quando o token esta pronto
   */
  jwt.sign(params, env.secretKey, {
    expiresIn: '1d' /*86400*/
  }, cb);
};
const validateUser = (form = {}) => {
  /**
   * validdadeUser retorna uma promise
   * validadeUser desestrura o form enviado pelo front
   * caso a entrada do usuário estiver faltando algum item obrigatório
   * reject é invocado e a é retornado um erro por usuário
   */
  return new Promise((resolve, reject) => {
    const {
      name: { first, last, nickname },
      email,
      password,
      confirmPassword
    } = form;

    if (first && last && nickname && email && password && confirmPassword) {
      if (password === confirmPassword) {
        resolve(email);
      } else
        reject({ error: 'Password not match' });
    } else if (!email) {
      reject({ error: 'Email not provided' });
    } else if (!password || !confirmPassword) {
      reject({ error: 'PassWord or ConfirmPassWord not provided' });
    } else if (!first) {
      reject({ error: 'First name not provided' });
    } else if (!last) {
      reject({ error: 'Last name not provided' });
    } else if (!nickname) {
      reject({ error: 'Nickname name not provided' });
    }
  });
};

route.get('/list', (req, res) => {
  /**
   * Apenas lista usuarios para testes na api
   */
  User.find()/*.populate('posts')*/.select('+posts +password +tokenForgotPassword +tokenForgotExpires').then((users) => {
    res.send({ users });
  });
});
route.get('/search/:content', (req, res) => {
  /**
   * Search faz uma busca no banco utilizando uma regex
   * Qualquer string com semelhanca é retornado do banco
   */
  const content = req.params.content.split('%20');

  const partsContent = content[0].split(' ');

  const lastname = partsContent.length <= 1 ? partsContent[0] : partsContent[1];

  User.find({
    $or: [
      { 'name.first': { $regex: new RegExp(partsContent[0], 'i') } },
      { 'name.last': { $regex: new RegExp(lastname, 'i') } },
      { 'name.nickname': { $regex: new RegExp(partsContent[0], 'i') } }
    ]
  })
    .select('-posts -createdAt -socialMedia -following -bio -email -photo.originalPhoto')
    .then(users => {
      res.send(users);

    }).catch(err => {
      res.status(400).send({ error: 'users not found' });
    });
});
route.get('/profile/:id', (req, res) => {
  /**
   * ProfileID recebe um ID de usuario no parametro
   * Busca no banco por esse ID
   * Se existir usuario cadastrado com aquele ID é retornado
   * Se nao retorna status 400
   */
  const { id } = req.params;
  User.findById({ _id: id })
    .populate({
      path: 'posts',
      populate: { path: 'assignedTo comments.assignedTo', select: 'name photo.thumbnail' },
    })
    .then(user => {

      if (!user) return res.status(400).send({ error: 'User not found' });
      res.send(user);
    }).catch(err => {
      res.status(400).send({ error: 'Request malformated' });
    });
});
route.post('/confirm/send', (req, res) => {
  /**
   * Confirm Send gera um hash aleatorio e envia um email pro usuario
   */
  const { email } = req.body;

  codeOfConfirm.generateCode(email).then(form => {
    res.send(form);
  }).catch(err => {
    res.status(500)
  });

});
route.post('/confirm/compare', (req, res) => {
  /**
   * Confirm Compare recebe o codigo de confirmacao e compara
   * Se ele etiver na RAM é aceito se nao é retornado 400
   */
  const { code } = req.body;

  codeOfConfirm.compareCode(code).then(response => {
    res.send();
  }).catch(err => {
    res.status(400).send({ error: err });
  })
});
route.post('/create', (req, res) => {
  /**
   * Create User primeiro confirma os campos preenchidos
   * Após verifica no banco de dados se aquele email já esta cadastrado
   * Payload recebe um foto padrao para caso o usuario nao estiver sekecionado uma
   * Se passar pelas confirmação o email com seus dados é inserido no banco de dados
   */
  validateUser(req.body).then((email) => {
    User.find({ email }).then((user) => {
      if (user.length) return res.status(400).send({ error: 'User already exists' });
      console.log(user);

      const payload = {
        ...req.body,
        photo: {
          thumbnail: `${env.dbStatic}/blank-profile.png`,
          originalPhoto: `${env.dbStatic}/blank-profile.png`,
        }
      };

      User.create(payload).then((user) => {
        user.password = undefined;

        generateToken({ id: user._id }, (err, token) => {
          if (err) return res.status(400).send({ error: 'Error on generate token' });

          res.status(201).send({ user, token });
        });

      }).catch(err => res.status(400).send({ error: 'Nickname already exists' }));
    }).catch(err => {
      console.log(err);
      res.status(400).send({ error: 'Input malformated' })
    });
  }).catch(err => res.status(400).send(err));
});
route.get('/exists/:id', (req, res) => {
  /**
   * Exists nao passa por token 
   * Recebe um email e verifica na base de dados de o email ja foi cadastrado
   * Para verificar no aplicativo se a logica de cadstro pode continuar
   */
  const email = req.params.id
  console.log(email);
  User.find({ email }).then(user => {
    if (user.length) return res.status(400).send({ error: 'User already exists' });

    return res.send({ message: 'User don\'t exists' });

  }).catch(err => res.status(400).send({ error: 'Email malformated' }));
});
route.get('/nicknameExists/:nickname', (req, res) => {
  /**
   * Nickname Exists recebe um nickname no parametro e verifica se o nickname ja esta cadastrado
   * Pra caso sim a aplicaco mobile nao aceitar aquele nickname
   * Entao nao seguira o fluxo de cadstro até a resposta da api ser Ok
   */
  const nickname = req.params.nickname;

  User.find({ 'name.nickname': nickname }).then(user => {

    if (user.length) return res.status(400).send({ error: 'Nickname already used' });

    res.send();

  }).catch(err => {
    res.status(400).send({ error: 'Request malformated' });
  });
});
route.patch('/profilePhoto/:id', uploadMiddleware, (req, res) => {
  /**
   * Pofile photo recebe um multiparti-form, no middleware é buscado o USER_ID
   * Se o ID nao for encontrado na base de dados...
   * req.upload é setado para <true> e a imagem vai para uma pasta de lixo no disco rigido
   * Se o usuário for encontrado na base de dados a middleware segue em frente
   * É levado uma referencia do usuario encontrada na base de dados pelo middleware
   * É pegado o destino da foto e também o nome da foto para atualizar os campos do usuário
   * Usuário tem dois campos [originalPhoto, thumbnail] que acompanha o link da imagem em disco
   * Sempre que a rota é chamada, é apagado as antigas fotos em disco para otimizar espaço
   */
  if (req.uploadError) return res.status(400).send({ error: 'User not found' });

  const user = req.model;
  const { photo: { thumbnail, originalPhoto } } = user;

  const { destination, filename } = req.file;
  const pathPhotoOriginal = `${destination}/${filename}`;
  const partsName = filename.split('-');
  const thumbnailName = `thumbnail-${partsName[1]}`;

  if (originalPhoto != `${env.dbStatic}/blank-profile.png`) {
    const partsToOriginalPath = originalPhoto.split('/');
    fs.unlink(`${env.diskStorage}/${partsToOriginalPath[3]}`, (err) => console.log(err));
  }
  if (thumbnail != `${env.dbStatic}/blank-profile.png`) {
    const partsToThumbnailPath = thumbnail.split('/');
    fs.unlink(`${env.diskStorage}/${partsToThumbnailPath[3]}`, (err) => console.log(err));
  }

  fs.readFile(pathPhotoOriginal, (err, buffer) => {
    if (err) return res.status(500).send({ error: 'Error on read file to resize' });

    sharp(buffer)
      .resize(240)
      .toFile(`${destination}/${thumbnailName}`)
      .then(() => {
        user.update({
          photo: {
            originalPhoto: `${env.dbStatic}/${filename}`,
            thumbnail: `${env.dbStatic}/${thumbnailName}`
          }
        }, (err) => {
          if (err) return res.status(500).send({ error: 'Error on setting profile image' });
          return res.send({
            photo: {
              originalPhoto: `${env.dbStatic}/${filename}`,
              thumbnail: `${env.dbStatic}/${thumbnailName}`
            }
          });
        });
      }).catch(err => {
        console.log({ err });
        res.status(400).send({ error: 'Error on load Image' })
      });
  });
});
route.put('/edit', (req, res) => {
  /**
   * Edit perfil de usuário recebe um USER_ID para buscar no banco
   * Metodo PUT porque recebe todas informações novamente como email
   * Busca ID no banco se encontrado o user é atualizado com os novos dados
   */
  const {
    bio,
    email,
    userId,
    password,
    socialMedia,
    name: { first, last, nickname },
  } = req.body;

  if (!userId || !email || !first || !last || !nickname || !password || !socialMedia) return res.status(400).send({ error: 'Input malformated' });

  User.findOne({ _id: userId })
    .select('+password')
    .then((user) => {
      if (!user) return res.status(400).send({ error: 'User not found' });

      if (user.name.nickname != nickname) {
        User.find({ 'name.nickname': nickname }).then(userToVerifyNickname => {
          if (userToVerifyNickname.length) return res.status(400).send({ error: 'Nickname already exists' });

          user.bio = bio;
          user.name.first = first;
          user.name.last = last;
          user.name.nickname = nickname;
          user.email = email;
          user.password = password;
          user.socialMedia = socialMedia;

          user.save((err) => {
            if (err) return res.status(500).send({ error: 'Error um updating user' });

            return res.send();
          });

        }).catch(err => {
          console.log(err);
        });
      }
      else {

        console.log('nickname nao sao diferentes');

        user.bio = bio;
        user.name.first = first;
        user.name.last = last;
        user.name.nickname = nickname;
        user.email = email;
        user.password = password;
        user.socialMedia = socialMedia;

        user.save((err) => {
          if (err) return res.status(500).send({ error: 'Error um updating user' });

          return res.send();
        });

      }


    }).catch(err => {
      console.log(err);
      res.status(400).send({ error: 'Upload malformated' })
    });
});
route.post('/auth', (req, res) => {
  /**
   * Auth primeiro verifica se o usuário foreneceu os dados necessarios
   * Se sim confere no banco se o usuario existe
   * Se sim bcrypt compara a senha com o hash do banco de dados
   * Se ok o usuario recebe um token valido por 1 dia
   */
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    if (!email) {
      return res.send({ error: 'Email not provide' });
    } else if (!password) {
      return res.send({ error: 'Password not provide' });
    }
  }

  User.findOne({ email }).select('+password').then((user) => {
    if (!user) return res.status(400).send({ error: 'User not found' });

    bcrypt.compare(password, user.password, (err, resultado) => {
      if (err) {
        return res.status(401).send({ error: 'Error login, try again' });
      } else if (!resultado) {
        return res.status(401).send({ error: 'Invalid password' })
      }

      user.password = undefined;

      generateToken({ id: user._id }, (err, token) => {
        if (err) return res.status(400).send({ error: 'Error on generate token' });

        res.send({ user, token });
        // jwt expired -> erro retornado quando expira o token //eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjVjNzNjYTE0NGRhOTViMjc0NDg1NmFiYSIsImlhdCI6MTU1MTA5MzM1NiwiZXhwIjoxNTUxMTc5NzU2fQ.5pi3Hsgz5KWb55QPEjyq1lEX76xPALcfW7JV-Nv-re4 
      });
    });
  }).catch(err => res.status(400).send({ error: 'Input malformated' }));
});
route.post('/validateToken', (req, res) => {
  /**
   * Validade token é so uma rota para passar pelo Middleware que valida o token
   * Se for validado ela cai nessa funcao e é retornado status 200 de OK
   * Se nao ela é rejeitada pelo middleware de validacao com erro de token expirado
   */
  const { userId } = req.body;

  User.findById({ _id: userId }).then(user => {
    if (!user) return res.status(400).send({ error: 'User not found' });

    res.send(user);

  }).catch(err => {
    console.log(err);
  })

});
route.post('/follow', (req, res) => {
  /**
   * Follow recebe um UserId de quem esta seguindo e um FollowId de quem ira seguir
   * Verifica na base de dados de o userId existe no bando
   * Se existir o campo de following recebe o novo FollowId de quem ira seguir
   */
  const { userId, followUserId } = req.body;

  if (!userId || !followUserId) return res.status(400).send({ error: 'Request malformated' });

  User.findById({ _id: userId }).then(user => {
    if (!user) return res.status(400).send({ error: 'User not found' });

    const alreadyFollow = user.following.find(id => id.toString() == followUserId);
    if (alreadyFollow) return res.status(400).send({ error: 'Already following' });

    const following = user.following;
    following.push(followUserId);

    user.update({ following }, () => {
      res.send();
    });

  }).catch(err => {
    res.status(400).send({ error: 'Request malformated' });
    console.log(err);
  })

})
route.post('/unfollow', (req, res) => {
  /**
   * Unfollow recebe um UserId de quem está deixando de seguir e um unfollowId de pessoa que sera deixada de seguir
   * Verifica na base de o UserId esta cadastrado
   * Se estiver é filtrado o campo de following do usuario
   * É preenchido um payload com o restante dos follows do usuario e entao atualzado o modelo do usuário
   */
  const { userId, unfollowUserId } = req.body;

  if (!userId || !unfollowUserId) return res.status(400).send({ error: 'UserId or UnfollowUserId not provided' });

  User.findById({ _id: userId }).then(user => {
    if (!user) return res.status(400).send({ error: 'User not found' });

    if (user.following.length) {
      const following = user.following;
      const payload = following.filter(followId => followId.toString() != unfollowUserId);

      user.update({ following: payload }, (err) => {
        if (err) return res.status(500).send({ error: 'Error on user updating' });

        return res.send();
      });
    }
    else {
      return res.status(400).send({ error: 'User following empty' });
    }
  }).catch(err => res.send({ error: 'Request malformated' }));
});
route.post('/forgot_password', (req, res) => {
  /**
   * Users Forgot his Password
   * Recebe um e-mail de quem esta querendo recuperar a senha
   * É salvo no modelo do usuario um token de recuperação e um tempo limite
   * Após isso o certo e-mail recebe o token no seu respectivo e-mail e já pode ir pra proxima rota
   */

  User.findOne({ email: req.body.email }).select('+password').then((user) => {
    if (!user) return res.status(400).send({ error: 'User not found' });

    const token = crypto.randomBytes(32).toString('HEX');
    const date = new Date()
    date.setHours(date.getHours() + 1);

    const newUser = {
      __v: user.__v,
      _id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      tokenForgotPassword: token,
      tokenForgotExpires: date.toString()
    }

    User.findByIdAndUpdate({ _id: user.id }, newUser).then(() => {
      sendMail(user.email, token).then(info => {
        return res.send({ message: 'Success', info });

      }).catch(err => res.status(500).send({ error: 'Error on send e-mail, try again' }));
    }).catch(err => res.status(500).send({ error: 'Error in updating user token to reset password' }));
  }).catch(err => res.status(400).send({ error: 'Request malformated' }));
});
route.patch('/reset_password', (req, res) => {
  /**
   * reset Password recebe um email e um token de recuperacao
   * Confirma se o usuario forneceu um token e uma nova senha
   * Se sim o email é procurado no banco de dados
   * Se encontrado o token e o tempo limite so conferidos
   * Se (token === user.token e tempoLimite < agora) => usuario é atualizado
   */
  const { token, email, password } = req.body;
  if (!token) return res.status(400).send({ error: 'Token no provided' });
  if (!password) return res.status(400).send({ error: 'Password not provided' });

  User.findOne({ email })
    .select('+password +tokenForgotPassword +tokenForgotExpires')
    .then((user) => {
      const date = new Date();
      date.setHours(date.getHours());

      if (user.tokenForgotPassword === token && user.tokenForgotExpires > date.toString()) {
        user.password = password;
        user.tokenForgotExpires = undefined;
        user.tokenForgotPassword = undefined;

        user.save(err => {
          if (err) return res.status(500).send({ error: 'Error on update user password, try again' });

          return res.send({ status: 'User password has benn reset ' });
        });
      }
      else if (user.tokenForgotExpires > date.toString()) {
        return res.status(400).send({ error: 'Token expired, get a new one' });
      }
      else {
        return res.status(400).send({ error: 'Token Invalid' });
      }
    }).catch(err => res.status(400).send({ error: 'User not found' }));
});
route.delete('/delete/:id', (req, res) => {
  /**
   * Delete User recebe um USER_ID
   * Verifica na base se esse usuario existe e o deleta
   * O metodo delete retorna o usuario deletado
   * Itero pelo campo do posts do usuario deletado
   * Invoco o metodo delete do post passando os POST_ID que pertenciam aquele usuário
   */
  User.findByIdAndRemove({ _id: req.params.id }).then(user => {

    if (user.posts.length) {
      user.posts.map(post => {
        Post.findByIdAndRemove({ _id: post }).then(() => null);
      });
    }
    if (user.photo) {
      if (user.photo.thumbnail) {
        const partsToPhotoThumbnailPath = user.photo.thumbnail.split('/');
        fs.unlink(`${env.diskStorage}/${partsToPhotoThumbnailPath[3]}`, () => null);
      }
      if (user.photo.originalPhoto) {
        const partsToPhotoOriginalPath = user.photo.originalPhoto.split('/');
        fs.unlink(`${env.diskStorage}/${partsToPhotoOriginalPath[3]}`, () => null);
      }
    }

    return res.send();

  }).catch(err => {
    console.log(err);
    res.status(400).send({ error: 'User not found' })
  });
});
route.delete('/delete_all', (req, res) => {
  User.deleteMany({}).then(() => {
    res.send({ remove: 'all' });
  });
});
route.post('/debug', (req, res) => {

  console.log(req.body);

  res.send();

});

module.exports = route;