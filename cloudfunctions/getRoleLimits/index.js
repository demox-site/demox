const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { roles } = event;

  if (!roles || !Array.isArray(roles) || roles.length === 0) {
    return {
      code: 400,
      msg: 'Invalid roles'
    };
  }

  try {
    const res = await db.collection('ai_builder_roles')
      .where({
        _id: _.in(roles)
      })
      .get();
    
    return {
      code: 0,
      data: res.data
    };
  } catch (e) {
    return {
      code: 500,
      msg: e.message
    };
  }
};
