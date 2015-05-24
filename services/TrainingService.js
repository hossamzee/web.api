
//
TrainingService = {

	//
	findForPlayerIdById: function(playerId, id){

		var queryGetTraining = DatabaseService.format('select trainings.*, (select decision from trainingPlayers where trainingId = trainings.id and playerId = tp.playerId) as playerDecision, (select count(groupPlayers.id) > 0 from groupPlayers, users, groups where groupPlayers.playerId = users.playerId and groupPlayers.groupId = groups.id and users.playerId = tp.playerId and groups.id = trainings.groupId and users.deletedAt is null and groups.deletedAt is null and groupPlayers.leftAt is null and groupPlayers.role = \'admin\') as adminable, (select count(id) from trainingPlayers where trainingPlayers.trainingId = trainings.id and trainingPlayers.decision = \'willcome\') willcomePlayersCount, (select count(id) from trainingPlayers where trainingPlayers.trainingId = trainings.id and trainingPlayers.decision = \'register-as-subset\') subsetPlayersCount, (select count(id) from trainingPlayers where trainingPlayers.trainingId = trainings.id and trainingPlayers.decision = \'apologize\') apologizePlayersCount, (select count(id) from trainingPlayers where trainingPlayers.trainingId = trainings.id and trainingPlayers.decision = \'notyet\') as notyetPlayersCount from trainingPlayers tp, trainings where tp.trainingId = trainings.id and tp.playerId = ? and trainings.id = ?;', [playerId, id]);
		
		return DatabaseService.query(queryGetTraining).then(function(trainings){

			if (trainings.length == 0){
				return null;
			}

			var training = trainings[0];
			return training;
		});
	},

	addGroupIdPlayersForPlayerIdToId: function(groupId, playerId, id){

		return GroupService.listPlayersByIdForPlayerId(groupId, playerId)

		.then(function(players){

			return Promise.each(players, function(player){

				return TrainingPlayerService.findOrCreate({trainingId: id, playerId: player.id, decision: 'notyet'});

			});

		});
	},

	listForGroupIdAndPlayerId: function(groupId, playerId){

		var queryListTrainingsForGroupIdAndPlayerId = DatabaseService.format('select userTrainings.id, userTrainings.name, userTrainings.status, (select count(id) from activityPlayers where playerId = userTrainings.playerId and readable = 0 and activityId in (select id from trainingActivities where trainingId = userTrainings.id)) as activitiesCount from (select trainings.*, users.playerId as playerId from groupPlayers, users, groups, trainings where groupPlayers.playerId = users.playerId and groupPlayers.groupId = groups.id and users.playerId = ? and groupPlayers.groupId = ? and groupPlayers.leftAt is null and groups.deletedAt is null and trainings.groupId = groups.id) as userTrainings order by coalesce(userTrainings.modifiedAt, userTrainings.createdAt) desc', [playerId, groupId]);

		return DatabaseService.query(queryListTrainingsForGroupIdAndPlayerId);
	},

	//
	create: function(parameters){

		//
		var authorId = parameters.authorId;

		//
		parameters.name = moment(parameters.startedAt).format('dddd، DD MMMM YYYY، hh:mm a');
		parameters.createdAt = new Date();

		//
		delete parameters.authorId;

		//
		var queryInsertTraining = DatabaseService.format('insert into trainings set ?', parameters);

		//
		return DatabaseService.query(queryInsertTraining)

		//
		.then(function(insertTrainingResult){

			var id = insertTrainingResult.insertId;

			//
			TrainingService.addGroupIdPlayersForPlayerIdToId(parameters.groupId, authorId, id)

			//
			.then(function(){
				return TrainingActivityService.create({trainingId: id, authorId: authorId, type: 'training-started'});
			});

			// Find the training by id.
			return TrainingService.findForPlayerIdById(authorId, id);
		});
	},

	//
	listPlayersById: function(id){

		var queryListTrainingPlayers = DatabaseService.format('select players.fullname, players.id, trainingPlayers.decision as decision from trainingPlayers, players where trainingPlayers.playerId = players.id and trainingPlayers.trainingId = ?', [id]);

		return DatabaseService.query(queryListTrainingPlayers);
	},

	detailsByPlayerIdAndId: function(playerId, id){

		var t = null;

		return TrainingService.findForPlayerIdById(playerId, id)

		//
		.then(function(training){

			if (!training){
				throw new BadRequestError('Training cannot be found.');
			}

			// Take a copy to be remembered.
			t = training;

			return TrainingService.listPlayersById(training.id);
		})

		//
		.then(function(players){

			// Set the sub arrays.
			t.willcomePlayers = [];
			t.subsetPlayers = [];
			t.apologizePlayers = [];
			t.notyetPlayers = [];

			return Promise.each(players, function(player){

				if (player.decision == 'willcome'){
					return t.willcomePlayers.push(player);
				}

				if (player.decision == 'apologize'){
					return t.apologizePlayers.push(player);
				}

				if (player.decision == 'register-as-subset'){
					return t.subsetPlayers.push(player);
				}

				// Otherwise, the player did not decide.
				return t.notyetPlayers.push(player);
			});
		})

		//
		.then(function(){
			return t;
		})
	},

	//
	cancelIdByPlayerId: function(id, playerId){

		//
		var t = null;

		// Get the training by id.
		return TrainingService.findForPlayerIdById(playerId, id)

		//
		.then(function(training){

			// Check if the training is valid.
			if (!training){
				throw new BadRequestError('The training cannot be found.');
			}

			//
			t = training;

			// Check if the player id is not admin.
			if (training.adminable == 0){
				throw new BadRequestError('The training cannot be canceled when the player is not admin.');
			}

			// Check if the training is already canceled.
			if (training.status == 'canceled'){
				throw new BadRequestError('The training is already canceled.');
			}

			return TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'training-canceled'});
		})

		// Update the status of the training to be 'canceled'.
		.then(function(trainingActivity){
			return TrainingService.updateForId({status: 'canceled'}, t.id);
		});
	},

	//
	updateForId: function(parameters, id){

		//
		parameters.modifiedAt = new Date();

		var queryUpdateTrainingById = DatabaseService.format('update trainings set ? where id = ?', [parameters, id]);
		
		return DatabaseService.query(queryUpdateTrainingById);

		// TODO: This could be fixed in a better way.
	},

	//
	decideForPlayerIdToComeToId: function(playerId, id, evenIfWasSubset){

		//
		var t = null;
		var ta = null;

		// Get the training by id.
		return TrainingService.findForPlayerIdById(playerId, id)

		//
		.then(function(training){

			// Check if the training is valid.
			if (!training){
				throw new BadRequestError('The training cannot be found.');
			}

			//
			t = training;

			// Check if the training is already canceled.
			if (t.status == 'canceled'){
				throw new BadRequestError('The training is already canceled.');
			}

			// TODO: Check if the attending time for the training has ended.

			// Check if the player id has decided.
			if (t.playerDecision == 'willcome' || (t.playerDecision == 'register-as-subset' && evenIfWasSubset == false)){
				throw new BadRequestError('The player id already has decided.');
			}

			// Check if the training is already completed.
			if (t.playersCount == t.willcomePlayersCount && t.subsetPlayersCount == t.registerAsSubsetPlayersCount){
				throw new BadRequestError('The training is already completed.');
			}

			// Check if there is enough space for attending as a major player.
			if (t.playersCount > t.willcomePlayersCount){
				return TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'player-decided-to-come'});
			}

			// Check if there is no enough space for that.
			if (t.subsetPlayersCount > t.registerAsSubsetPlayersCount){
				return TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'register-as-subset'});
			}
		})

		// Update the training player decision.
		.then(function(activity){

			//
			ta = activity;

			if (activity.type == 'player-decided-to-come'){
				return TrainingPlayerService.updateDecisionByTrainingIdAndPlayerId('willcome', t.id, playerId);
			}

			if (activity.type == 'register-as-subset'){
				return TrainingPlayerService.updateDecisionByTrainingIdAndPlayerId('register-as-subset', t.id, playerId);
			}
		})

		// Check if the training now is completed.
		.then(function(){

			if (ta.type == 'player-decided-to-come'){

				// If the training is completed, create activity and notify the players.
				if (t.playersCount == t.willcomePlayersCount + 1){

					console.log('The training is now completed.');

					// Complete the training.
					TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'training-completed'})

					//
					.then(function(completedActivity){
						return TrainingService.updateForId({status: 'completed'});
					});
				}
			}

			// Just to assure that the promise has been fullfilled.
			return true;
		})
	},

	//
	decideForPlayerIdToApologizeToId: function(playerId, id){

		//
		var t = null;
		var ta = null;

		// Get the training by id.
		return TrainingService.findForPlayerIdById(playerId, id)

		//
		.then(function(training){

			// Check if the training is valid.
			if (!training){
				throw new BadRequestError('The training cannot be found.');
			}

			//
			t = training;

			// Check if the training is already canceled.
			if (t.status == 'canceled'){
				throw new BadRequestError('The training is already canceled.');
			}

			// TODO: Check if the attending time for the training has ended.

			// Check if the player id has decided.
			if (t.playerDecision == 'apologize'){
				throw new BadRequestError('The player id already has decided.');
			}

			// TODO: If it is too late then it is too late.

			//
			return TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'player-apologized'});
		})

		// Update the training player decision.
		.then(function(activity){

			//
			ta = activity;

			//
			return TrainingPlayerService.updateDecisionByTrainingIdAndPlayerId('apologize', t.id, playerId);
		})

		//
		.then(function(){

			if (t.playerDecision == 'willcome' && t.status == 'completed'){

				// Update the status of the training to be 'gathering'.
				TrainingService.updateForId({status: 'gathering'})

				// Add an activity saying that the training is not completed w/ notifying players.
				.then(function(){
					return TrainingActivityService.create({trainingId: t.id, authorId: playerId, type: 'training-not-completed'});
				})

				// Subset the best player if any.
				.then(function(activity){
					return TrainingService.subsetBestPlayerForId(t.id);
				});
			}

			// Just to assure that the promise has been fullfilled.
			return true;
		})
	},

	//
	subsetBestPlayerForId: function(id){

		//
		var queryGetTrainingSubsetPlayers = DatabaseService.format('select * from trainingPlayers where trainingId = ? and decision = \'register-as-subset\' order by coalesce(modifiedAt, createdAt)', [id]);

		//
		return DatabaseService.query(queryGetTrainingSubsetPlayers)

		//
		.then(function(subsetPlayers){

			//
			if (subsetPlayers.length == 0){
				console.log('No subset players have been found.');
				return true;
			}

			//
			var subsetPlayer = subsetPlayers[0];

			//
			return TrainingService.decideForPlayerIdToComeToId(subsetPlayer.playerId, id, true);
		});
	}
};