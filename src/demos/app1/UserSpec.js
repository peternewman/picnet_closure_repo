goog.provide('pn.demo.app1.UserSpec');

goog.require('pn.ui.UiSpec');
goog.require('pn.ui.grid.Config');
goog.require('pn.ui.edit.Command');

/** 
 * @constructor
 * @extends {pn.ui.UiSpec}
 */
pn.demo.app1.UserSpec = function() {
  pn.ui.UiSpec.call(this, 'User');
};
goog.inherits(pn.demo.app1.UserSpec, pn.ui.UiSpec);

/** @override */
pn.demo.app1.UserSpec.prototype.getGridConfig = function(cache) {
  var columns = [
    this.createColumn('FirstName', cache),
    this.createColumn('LastName', cache),
    this.createColumn('Phone', cache),
    this.createColumn('DateOfBirth', cache)
  ];  
  var add = new pn.ui.grid.Command('Add', pn.app.AppEvents.ENTITY_ADD);
  return new pn.ui.grid.Config(columns, [add]);
};


/** @override */
pn.demo.app1.UserSpec.prototype.getEditConfig = function(entity, cache) {
  var fields = [
    this.createField('FirstName', cache),
    this.createField('LastName', cache),
    this.createField('Phone', cache),
    this.createField('DateOfBirth', cache)
  ];
  var save = new pn.ui.edit.Command('Save', pn.app.AppEvents.ENTITY_SAVE, true);
  save.click = goog.bind(this.save_, this);
  var back = new pn.ui.edit.Command('Back', pn.app.AppEvents.ENTITY_CANCEL);
  var commands = [ save, back ];
  return new pn.ui.edit.Config(fields, commands);
};

/**
 * @private
 * @param {!Object} entity The entity being saved.
 */
pn.demo.app1.UserSpec.prototype.save_ = function(entity) {
  var users = pn.app.ctx.users;
  if (entity['ID'] <= 0) { // New entity
    entity['ID'] = (++pn.demo.app1.DemoUtils.counter);
    users.push(entity);
  } else { // Edit
    for (var i = 0, len = users.length; i < len; i++) {
      if (users[i]['ID'] === entity['ID']) {
        users[i] = entity;
        break;
      }
    }  
  }
  pn.app.ctx.pub(pn.app.AppEvents.ENTITY_SAVED);
};